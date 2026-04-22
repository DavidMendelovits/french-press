import * as fs from 'fs';
import * as path from 'path';

export interface TaskState {
  issueNumber: number;
  lastAttemptedAt: string;
  lastPhase: 'plan' | 'execute' | 'review' | 'qa';
  outcome: 'in_progress' | 'success' | 'failed' | 'skipped';
  prNumber?: number;
  worktreePath?: string;
}

export interface AgentState {
  lastRunAt: string;
  surpriseLastFiredAt?: string;
  tasks: TaskState[];
}

function freshState(): AgentState {
  return { lastRunAt: new Date().toISOString(), tasks: [] };
}

export function readState(statePath: string): AgentState {
  if (!fs.existsSync(statePath)) return freshState();
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as AgentState;
    if (!Array.isArray(parsed.tasks)) return freshState();
    return parsed;
  } catch {
    return freshState();
  }
}

export function writeState(statePath: string, state: AgentState): void {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = statePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, statePath);
}
