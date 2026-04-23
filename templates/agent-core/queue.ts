import { execSync } from 'child_process';
import { AgentState } from './state';

export interface FrenchPressConfig {
  issueLabels: string[];
  testCommand: string;
  e2eCommand?: string;
  deployTarget: string;
  surpriseEnabled: boolean;
  retryAfterHours: number;
  ciTimeoutSeconds: number;
  envLoader: 'doppler' | 'dotenv' | 'none';
}

export interface RunOpts {
  dryRun: boolean;
}

export type WorkItemKind = 'issue' | 'todo' | 'surprise';

export interface WorkItem {
  kind: WorkItemKind;
  issueNumber?: number;
  title: string;
  todoFile?: string;
  todoLine?: number;
}

interface GHIssue {
  number: number;
  title: string;
}

function fetchIssues(config: FrenchPressConfig): GHIssue[] {
  const seen = new Set<number>();
  const issues: GHIssue[] = [];
  for (const label of config.issueLabels) {
    const raw = execSync(`gh issue list --label "${label}" --json number,title --limit 20`, { encoding: 'utf-8' });
    for (const issue of JSON.parse(raw) as GHIssue[]) {
      if (!seen.has(issue.number)) {
        seen.add(issue.number);
        issues.push(issue);
      }
    }
  }
  return issues;
}

function scanTodos(): WorkItem[] {
  try {
    const raw = execSync('grep -rn "TODO(french-press)" --include="*.ts" --include="*.tsx" --include="*.js" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=french-press .', { encoding: 'utf-8' });
    const items: WorkItem[] = [];
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const m = line.match(/^(.+):(\d+):.+TODO\(french-press\)\s*(.+)/);
      if (m) items.push({ kind: 'todo', title: m[3].trim(), todoFile: m[1], todoLine: parseInt(m[2], 10) });
    }
    return items;
  } catch {
    return [];
  }
}

function isWithinRetryWindow(lastAttemptedAt: string, retryAfterHours: number): boolean {
  const elapsed = Date.now() - new Date(lastAttemptedAt).getTime();
  return elapsed < retryAfterHours * 60 * 60 * 1000;
}

function shouldFireSurprise(config: FrenchPressConfig, state: AgentState): boolean {
  if (!config.surpriseEnabled) return false;
  if (!state.surpriseLastFiredAt) return true;
  const elapsed = Date.now() - new Date(state.surpriseLastFiredAt).getTime();
  return elapsed >= 24 * 60 * 60 * 1000;
}

export function buildQueue(config: FrenchPressConfig, state: AgentState): WorkItem[] {
  const attempted = new Map(state.tasks.map(t => [t.issueNumber, t]));
  const queue: WorkItem[] = [];

  const issues = fetchIssues(config);
  for (const issue of issues) {
    const prior = attempted.get(issue.number);
    if (prior && isWithinRetryWindow(prior.lastAttemptedAt, config.retryAfterHours)) continue;
    queue.push({ kind: 'issue', issueNumber: issue.number, title: issue.title });
  }

  queue.push(...scanTodos());

  if (shouldFireSurprise(config, state)) {
    queue.push({ kind: 'surprise', title: 'Surprise improvement task' });
  }

  return queue;
}
