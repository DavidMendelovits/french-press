import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FrenchPressConfig, RunOpts, buildQueue, WorkItem } from './queue';
import { AgentState, TaskState, readState, writeState } from './state';
import { runPlan, runExecute, runReview, runQA } from './phases';

const CONFIG_PATH = path.join(process.cwd(), 'french-press-config.json');
const STATE_PATH = path.join(process.cwd(), '.french-press-state.json');
const WIKI_PATH = path.join(process.cwd(), '.french-press-wiki.jsonl');
const WT_BASE = path.join(os.tmpdir(), 'french-press-wt');

// Track active worktrees for process.on('exit') cleanup.
const activeWorktrees = new Set<string>();

process.on('exit', () => {
  for (const wt of activeWorktrees) {
    if (fs.existsSync(wt)) {
      try {
        spawnSync('git', ['worktree', 'remove', wt, '--force'], { stdio: 'ignore' });
        fs.rmSync(wt, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
});

export function preflight(): void {
  // Check gh auth
  const ghCheck = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  if (ghCheck.status !== 0) {
    console.error('ERROR: gh CLI is not authenticated. Run: gh auth login');
    process.exit(1);
  }

  // Check claude binary
  const claudeCheck = spawnSync('claude', ['--version'], { stdio: 'ignore' });
  if (claudeCheck.error != null) {
    console.error('ERROR: claude CLI not found. Install from https://claude.ai/code');
    process.exit(1);
  }

  // Check state path writable
  const stateDir = path.dirname(STATE_PATH);
  try {
    fs.accessSync(stateDir, fs.constants.W_OK);
  } catch {
    console.error(`ERROR: state directory not writable: ${stateDir}`);
    process.exit(1);
  }
}

function parseArgs(): RunOpts {
  return { dryRun: process.argv.includes('--dry-run') };
}

function loadConfig(): FrenchPressConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`ERROR: french-press-config.json not found at ${CONFIG_PATH}`);
    console.error('Run the /french-press skill to scaffold this repo first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as FrenchPressConfig;
}

function makeWorktree(issueNumber: number): string {
  const wt = path.join(WT_BASE, `issue-${issueNumber}`);
  fs.mkdirSync(WT_BASE, { recursive: true });
  spawnSync('git', ['worktree', 'remove', wt, '--force'], { stdio: 'ignore' });
  spawnSync('git', ['fetch', 'origin', '-q'], { stdio: 'inherit' });
  const result = spawnSync('git', ['worktree', 'add', wt, 'origin/main', '-q'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Failed to create worktree at ${wt}`);
  activeWorktrees.add(wt);
  return wt;
}

function removeWorktree(wt: string): void {
  activeWorktrees.delete(wt);
  if (fs.existsSync(wt)) {
    spawnSync('git', ['worktree', 'remove', wt, '--force'], { stdio: 'ignore' });
    fs.rmSync(wt, { recursive: true, force: true });
  }
}

function findOrCreateTask(state: AgentState, issueNumber: number): TaskState {
  const existing = state.tasks.find(t => t.issueNumber === issueNumber);
  if (existing) return existing;
  const task: TaskState = {
    issueNumber,
    lastAttemptedAt: new Date().toISOString(),
    lastPhase: 'plan',
    outcome: 'in_progress',
  };
  state.tasks.push(task);
  return task;
}

async function processIssue(
  item: WorkItem,
  config: FrenchPressConfig,
  state: AgentState,
  opts: RunOpts,
): Promise<void> {
  if (item.issueNumber == null) return;
  const num = item.issueNumber;
  console.log(`\n────── Issue #${num}: ${item.title} ──────`);

  if (opts.dryRun) {
    console.log(`[dry-run] Would process issue #${num}`);
    return;
  }

  const task = findOrCreateTask(state, num);
  task.lastAttemptedAt = new Date().toISOString();

  const planFile = path.join(os.tmpdir(), `fp-plan-${num}.md`);
  const wt = makeWorktree(num);
  task.worktreePath = wt;
  writeState(STATE_PATH, state);

  const phaseOpts = {
    issueNumber: num,
    planFile,
    workdir: wt,
    config,
    wikiPath: WIKI_PATH,
    ciTimeoutSeconds: config.ciTimeoutSeconds,
    prNumber: task.prNumber,
  };

  // Phase resumption: if PR already exists from a prior run, skip plan+execute.
  const resumeAtReview = task.prNumber != null && task.outcome === 'in_progress';

  if (!resumeAtReview) {
    task.lastPhase = 'plan';
    writeState(STATE_PATH, state);
    const planResult = runPlan(phaseOpts);
    if (planResult.outcome === 'failed') {
      task.outcome = 'failed';
      writeState(STATE_PATH, state);
      removeWorktree(wt);
      return;
    }

    // Check if planner deferred
    if (fs.existsSync(planFile) && fs.readFileSync(planFile, 'utf-8').includes('STATUS: DEFER')) {
      task.outcome = 'skipped';
      writeState(STATE_PATH, state);
      removeWorktree(wt);
      return;
    }

    task.lastPhase = 'execute';
    writeState(STATE_PATH, state);
    const executeResult = runExecute(phaseOpts);
    if (executeResult.outcome === 'failed') {
      task.outcome = 'failed';
      writeState(STATE_PATH, state);
      removeWorktree(wt);
      return;
    }

    // Capture PR number from gh output
    try {
      const prNum = execSync(
        `gh pr list --state open --draft --json number,headRefName --jq ".[] | select(.headRefName | startswith(\\"fix/issue-${num}-\\")) | .number" | head -1`,
        { encoding: 'utf-8' },
      ).trim();
      if (prNum) task.prNumber = parseInt(prNum, 10);
    } catch {
      // continue without PR number
    }
  }

  task.lastPhase = 'review';
  writeState(STATE_PATH, state);
  const reviewResult = runReview({ ...phaseOpts, prNumber: task.prNumber });
  if (reviewResult.outcome === 'failed') {
    task.outcome = 'failed';
    writeState(STATE_PATH, state);
    removeWorktree(wt);
    return;
  }

  if (config.e2eCommand) {
    task.lastPhase = 'qa';
    writeState(STATE_PATH, state);
    runQA({ ...phaseOpts, prNumber: task.prNumber });
  }

  task.outcome = 'success';
  task.worktreePath = undefined;
  writeState(STATE_PATH, state);
  removeWorktree(wt);
}

async function main(): Promise<void> {
  const opts = parseArgs();
  preflight();

  const config = loadConfig();
  const state = readState(STATE_PATH);
  state.lastRunAt = new Date().toISOString();

  const queue = buildQueue(config, state);
  console.log(`Queue: ${queue.length} items`);

  if (opts.dryRun) {
    for (const item of queue) {
      console.log(`[dry-run] Would process: ${item.kind} ${item.issueNumber ? `#${item.issueNumber}` : ''} ${item.title}`);
    }
  } else {
    for (const item of queue) {
      if (item.kind === 'issue') {
        await processIssue(item, config, state, opts);
      } else if (item.kind === 'todo') {
        console.log(`[todo] ${item.title} — skipping (not yet implemented)`);
      } else if (item.kind === 'surprise') {
        console.log('[surprise] Surprise task — skipping (not yet implemented)');
      }
    }
  }

  state.lastRunAt = new Date().toISOString();
  writeState(STATE_PATH, state);
  console.log('\n✓ french-press run complete');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
