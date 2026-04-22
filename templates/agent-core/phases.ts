import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FrenchPressConfig } from './queue';
import { TaskState } from './state';
import { writeWiki, Learning } from './wiki';

export interface PhaseResult {
  outcome: 'success' | 'failed';
  learning?: Learning;
}

interface PhaseOpts {
  issueNumber?: number;
  planFile?: string;
  prNumber?: number;
  workdir: string;
  config: FrenchPressConfig;
  wikiPath: string;
  ciTimeoutSeconds: number;
}

const MODEL_OPUS = 'claude-opus-4-7';
const MODEL_SONNET = 'claude-sonnet-4-6';

type ClaudeResult = 'success' | 'failed' | 'timeout';

function runClaude(model: string, prompt: string, workdir: string, timeoutMs: number): ClaudeResult {
  const result = spawnSync('claude', ['--dangerously-skip-permissions', '--model', model, '-p', prompt], {
    cwd: workdir,
    stdio: 'inherit',
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  if (result.signal === 'SIGTERM' || result.status === null) return 'timeout';
  return result.status === 0 ? 'success' : 'failed';
}

function pitfallLearning(phase: string, issueNumber: number | undefined, error: string): Learning {
  return {
    id: `phase-crash-${phase}-${Date.now()}`,
    date: new Date().toISOString(),
    type: 'pitfall',
    key: `phase-crash-${phase}`,
    insight: `${phase} phase crashed: ${error.slice(0, 200)}`,
    context: issueNumber != null ? `issue #${issueNumber}` : 'unknown task',
    confidence: 1.0,
  };
}

function timeoutLearning(phase: string, issueNumber: number | undefined, timeoutSeconds: number): Learning {
  return {
    id: `phase-timeout-${phase}-${Date.now()}`,
    date: new Date().toISOString(),
    type: 'pitfall',
    key: `phase-timeout-${phase}`,
    insight: `${phase} phase timed out after ${timeoutSeconds}s`,
    context: issueNumber != null ? `issue #${issueNumber}` : 'unknown task',
    confidence: 1.0,
  };
}

export function runPlan(opts: PhaseOpts): PhaseResult {
  const { issueNumber, planFile, workdir, config, wikiPath } = opts;
  const pf = planFile ?? path.join(os.tmpdir(), `fp-plan-${issueNumber ?? 'task'}.md`);

  const learningsNote = fs.existsSync(wikiPath)
    ? `\nRead past learnings from ${wikiPath} before planning.`
    : '';

  const prompt = `You are the PLANNER agent.${learningsNote}
You DO NOT write code. Your deliverable is a plan file at ${pf}.

Work on issue #${issueNumber ?? '(see context)'}.

## Step 1 — Coordination check
Find any existing PR for this issue:
  gh pr list --state open --json number,title,headRefName \\
    --jq '.[] | select(.headRefName | startswith("fix/issue-${issueNumber}-"))'
If one exists, write STATUS: DEFER and REASON to ${pf} and exit.

## Step 2 — Read the issue
  gh issue view ${issueNumber}

## Step 3 — Explore
Read/Grep/Glob the relevant code. Do not touch unrelated files.

## Step 4 — Write the plan to ${pf}
Format:
  # Plan: issue #${issueNumber}
  STATUS: ACTION

  ## Problem
  ## Approach (3-8 bullets naming functions)
  ## Files (path — what changes)
  ## Risks & edge cases
  ## Test strategy

## Action bias
Default to shipping. DEFER only when the issue is genuinely ambiguous about what to build.

Write the plan file. Do not edit code. Do not create branches. Exit.`;

  try {
    const claudeResult = runClaude(MODEL_OPUS, prompt, workdir, opts.ciTimeoutSeconds * 1000);
    if (claudeResult === 'timeout') {
      const learning = timeoutLearning('plan', issueNumber, opts.ciTimeoutSeconds);
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    if (claudeResult !== 'success' || !fs.existsSync(pf)) {
      const learning = pitfallLearning('plan', issueNumber, 'claude exited non-zero or no plan file produced');
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    const content = fs.readFileSync(pf, 'utf-8');
    if (content.includes('STATUS: DEFER')) return { outcome: 'success' };
    return { outcome: 'success' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const learning = pitfallLearning('plan', issueNumber, msg);
    writeWiki(wikiPath, learning);
    return { outcome: 'failed', learning };
  }
}

export function runExecute(opts: PhaseOpts): PhaseResult {
  const { issueNumber, planFile, workdir, wikiPath } = opts;
  const pf = planFile ?? path.join(os.tmpdir(), `fp-plan-${issueNumber ?? 'task'}.md`);

  const prompt = `You are the EXECUTOR agent for issue #${issueNumber}.
A planner wrote the plan at ${pf}.

## Step 1 — Read the plan
Read ${pf}. If STATUS is not ACTION, exit immediately.

## Step 2 — Read the issue
  gh issue view ${issueNumber}

## Step 3 — Implement
  git checkout -b fix/issue-${issueNumber}-<short-slug>
Follow the plan. If the plan is wrong in a small way, adapt and note the deviation
in the PR body. If fundamentally wrong, comment on the issue with the blocker and exit.

## Step 4 — Verify
Run: ${opts.config.testCommand}
Fix any failures.

## Step 5 — Open a DRAFT PR
  gh pr create --draft --title "..." --body "Fixes #${issueNumber}\\n\\n<summary>"
Include: plan contents, user action items (env vars, manual steps), or "none".

## Safety rules
- Never force-push. Never touch main directly.
- One issue = one PR, scope-limited.
- Write real code. No stub implementations.`;

  try {
    const claudeResult = runClaude(MODEL_SONNET, prompt, workdir, opts.ciTimeoutSeconds * 1000);
    if (claudeResult === 'timeout') {
      const learning = timeoutLearning('execute', issueNumber, opts.ciTimeoutSeconds);
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    if (claudeResult !== 'success') {
      const learning = pitfallLearning('execute', issueNumber, 'claude exited non-zero');
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    return { outcome: 'success' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const learning = pitfallLearning('execute', issueNumber, msg);
    writeWiki(wikiPath, learning);
    return { outcome: 'failed', learning };
  }
}

export function runReview(opts: PhaseOpts): PhaseResult {
  const { issueNumber, planFile, prNumber, workdir, wikiPath, ciTimeoutSeconds } = opts;
  const pf = planFile ?? path.join(os.tmpdir(), `fp-plan-${issueNumber ?? 'task'}.md`);

  const ciNote = prNumber
    ? `\nCI timeout budget: ${ciTimeoutSeconds}s. Poll gh pr checks ${prNumber} until all pass or timeout.`
    : '';

  const prompt = `You are the REVIEWER agent for issue #${issueNumber}.${ciNote}
Plan: ${pf}

## Step 1 — Find the PR
  gh pr list --state open --draft --json number,headRefName,title \\
    --jq '.[] | select(.headRefName | startswith("fix/issue-${issueNumber}-"))'
If no draft PR exists, exit.

## Step 2 — Check out and review
  git fetch origin && git checkout <headRefName>
  cat ${pf}
  git diff origin/main...HEAD

## Step 3 — Verify
- Diff matches planned files and approach
- No TODO stubs beyond documented mocks
- No bugs, type errors, dead code, or committed secrets
- User action items are accurate

## Step 4 — Decide
PASS: gh pr ready <number>
CHANGES NEEDED: push a fixup commit or leave a specific comment (keep as draft).

Bar: "would I be happy to see this PR in the morning?"

Call advisor() before PASS if the change touches security, auth, payment, or data integrity.`;

  try {
    const claudeResult = runClaude(MODEL_SONNET, prompt, workdir, ciTimeoutSeconds * 1000);
    if (claudeResult === 'timeout') {
      const learning = timeoutLearning('review', issueNumber, ciTimeoutSeconds);
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    if (claudeResult !== 'success') {
      const learning = pitfallLearning('review', issueNumber, 'claude exited non-zero');
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    return { outcome: 'success' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const learning = pitfallLearning('review', issueNumber, msg);
    writeWiki(wikiPath, learning);
    return { outcome: 'failed', learning };
  }
}

export function runQA(opts: PhaseOpts): PhaseResult {
  const { issueNumber, prNumber, workdir, wikiPath, config } = opts;
  if (!config.e2eCommand) return { outcome: 'success' };

  const prompt = `You are the QA WRITER agent for issue #${issueNumber}.
Read past learnings from ${wikiPath} before writing any test code.

## Step 1 — Find and check out the PR branch
  git fetch origin
  BRANCH=$(gh pr list --state open --draft \\
    --json headRefName \\
    --jq ".[] | select(.headRefName | startswith('fix/issue-${issueNumber}-')) | .headRefName" \\
    | head -1)
  git checkout "$BRANCH"

If no matching branch, exit without creating any files.

## Step 2 — Understand the feature
  git diff origin/main...HEAD

## Step 3 — Verify selectors before writing assertions
Grep component source for every element you plan to assert on. Never guess from
issue description alone.

## Step 4 — Write one targeted e2e test file
Rules:
- Test user-visible behavior only
- Do not wait on real AI/API responses — assert immediate UI state
- 1 to 3 test cases, each under 20 lines

## Step 5 — Commit and push
  git add <test-file>
  git commit -m "test(e2e): feature test for issue #${issueNumber}"
  git push origin "$BRANCH"

Then run: ${config.e2eCommand}

Exit.`;

  try {
    const claudeResult = runClaude(MODEL_SONNET, prompt, workdir, opts.ciTimeoutSeconds * 1000);
    if (claudeResult === 'timeout') {
      const learning = timeoutLearning('qa', issueNumber, opts.ciTimeoutSeconds);
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    if (claudeResult !== 'success') {
      const learning = pitfallLearning('qa', issueNumber, 'claude exited non-zero');
      writeWiki(wikiPath, learning);
      return { outcome: 'failed', learning };
    }
    return { outcome: 'success' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const learning = pitfallLearning('qa', issueNumber, msg);
    writeWiki(wikiPath, learning);
    return { outcome: 'failed', learning };
  }
}
