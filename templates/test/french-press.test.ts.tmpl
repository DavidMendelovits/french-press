import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock child_process so no real git/gh/claude calls are made.
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0, error: null })),
}));

import { execSync, spawnSync } from 'child_process';
import { readWiki, writeWiki, type Learning } from './wiki';
import { readState, writeState, type AgentState } from './state';
import { buildQueue, type FrenchPressConfig } from './queue';
import { runPlan, runReview } from './phases';

const mockExecSync = vi.mocked(execSync);
const mockSpawnSync = vi.mocked(spawnSync);

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'));
}

function makeConfig(overrides: Partial<FrenchPressConfig> = {}): FrenchPressConfig {
  return {
    issueLabels: ['bug'],
    testCommand: 'npm test',
    deployTarget: 'vercel',
    surpriseEnabled: false,
    retryAfterHours: 24,
    ciTimeoutSeconds: 600,
    envLoader: 'none',
    ...overrides,
  };
}

function emptyState(): AgentState {
  return { lastRunAt: new Date().toISOString(), tasks: [] };
}

// ── wiki tests ───────────────────────────────────────────────────────────────

describe('wiki', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true }); });

  function wikiPath() { return path.join(dir, 'wiki.jsonl'); }
  function entry(key: string, insight = 'some insight'): Learning {
    return { id: key, date: new Date().toISOString(), type: 'pitfall', key, insight, context: 'ctx', confidence: 0.9 };
  }

  it('returns empty array when file does not exist', () => {
    expect(readWiki(wikiPath())).toEqual([]);
  });

  it('appends new entry', () => {
    writeWiki(wikiPath(), entry('k1'));
    expect(readWiki(wikiPath())).toHaveLength(1);
  });

  it('deduplicates by key — increments count on second write', () => {
    writeWiki(wikiPath(), entry('k1', 'first'));
    writeWiki(wikiPath(), entry('k1', 'second'));
    const results = readWiki(wikiPath());
    expect(results).toHaveLength(1);
    expect(results[0].count).toBe(2);
    expect(results[0].insight).toBe('second');
  });

  it('deduplicates by key — count reaches 3 on third write', () => {
    writeWiki(wikiPath(), entry('k1'));
    writeWiki(wikiPath(), entry('k1'));
    writeWiki(wikiPath(), entry('k1'));
    expect(readWiki(wikiPath())[0].count).toBe(3);
  });

  it('keeps distinct keys as separate entries', () => {
    writeWiki(wikiPath(), entry('k1'));
    writeWiki(wikiPath(), entry('k2'));
    expect(readWiki(wikiPath())).toHaveLength(2);
  });

  it('skips malformed JSONL lines without throwing', () => {
    fs.writeFileSync(wikiPath(), 'not-json\n' + JSON.stringify(entry('k1')) + '\n');
    expect(readWiki(wikiPath())).toHaveLength(1);
  });
});

// ── state tests ───────────────────────────────────────────────────────────────

describe('state', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true }); });

  function statePath() { return path.join(dir, 'state.json'); }

  // Critical test 4: readState with corrupt file → returns fresh AgentState
  it('returns fresh AgentState when file does not exist', () => {
    const state = readState(statePath());
    expect(state.tasks).toEqual([]);
  });

  it('returns fresh AgentState on corrupt JSON', () => {
    fs.writeFileSync(statePath(), '{invalid json}');
    expect(readState(statePath()).tasks).toEqual([]);
  });

  it('returns fresh AgentState when tasks field is missing', () => {
    fs.writeFileSync(statePath(), JSON.stringify({ lastRunAt: '2026-01-01' }));
    expect(readState(statePath()).tasks).toEqual([]);
  });

  it('round-trips state correctly', () => {
    const s: AgentState = {
      lastRunAt: '2026-04-17T00:00:00.000Z',
      tasks: [{ issueNumber: 42, lastAttemptedAt: '2026-04-17T00:00:00.000Z', lastPhase: 'plan', outcome: 'in_progress' }],
    };
    writeState(statePath(), s);
    const loaded = readState(statePath());
    expect(loaded.tasks[0].issueNumber).toBe(42);
  });

  it('writeState is atomic — no .tmp file left behind', () => {
    writeState(statePath(), emptyState());
    expect(fs.existsSync(statePath() + '.tmp')).toBe(false);
    expect(fs.existsSync(statePath())).toBe(true);
  });
});

// ── queue tests ───────────────────────────────────────────────────────────────

describe('buildQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // scanTodos grep — return empty (no TODOs)
    mockExecSync.mockReturnValue('' as unknown as Buffer);
  });

  // Critical test 1: skips tasks attempted within retryAfterHours
  it('skips issues attempted within retryAfterHours', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ number: 1, title: 'Fix bug' }]) as unknown as Buffer)
      .mockReturnValue('' as unknown as Buffer);

    const state: AgentState = {
      lastRunAt: new Date().toISOString(),
      tasks: [{
        issueNumber: 1,
        lastAttemptedAt: new Date().toISOString(), // just now
        lastPhase: 'plan',
        outcome: 'failed',
      }],
    };

    const queue = buildQueue(makeConfig({ retryAfterHours: 24 }), state);
    expect(queue.filter(i => i.issueNumber === 1)).toHaveLength(0);
  });

  it('includes issues outside the retryAfterHours window', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ number: 2, title: 'Old bug' }]) as unknown as Buffer)
      .mockReturnValue('' as unknown as Buffer);

    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const state: AgentState = {
      lastRunAt: new Date().toISOString(),
      tasks: [{
        issueNumber: 2,
        lastAttemptedAt: oldDate,
        lastPhase: 'plan',
        outcome: 'failed',
      }],
    };

    const queue = buildQueue(makeConfig({ retryAfterHours: 24 }), state);
    expect(queue.filter(i => i.issueNumber === 2)).toHaveLength(1);
  });

  it('includes never-attempted issues', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ number: 3, title: 'New bug' }]) as unknown as Buffer)
      .mockReturnValue('' as unknown as Buffer);

    const queue = buildQueue(makeConfig(), emptyState());
    expect(queue.filter(i => i.issueNumber === 3)).toHaveLength(1);
  });

  it('adds surprise item when enabled and never fired', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([]) as unknown as Buffer)
      .mockReturnValue('' as unknown as Buffer);

    const queue = buildQueue(makeConfig({ surpriseEnabled: true }), emptyState());
    expect(queue.some(i => i.kind === 'surprise')).toBe(true);
  });

  it('does not add surprise item when fired within 24h', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([]) as unknown as Buffer)
      .mockReturnValue('' as unknown as Buffer);

    const state: AgentState = {
      lastRunAt: new Date().toISOString(),
      surpriseLastFiredAt: new Date().toISOString(),
      tasks: [],
    };

    const queue = buildQueue(makeConfig({ surpriseEnabled: true }), state);
    expect(queue.some(i => i.kind === 'surprise')).toBe(false);
  });
});

// ── phases tests ───────────────────────────────────────────────────────────────

describe('phases', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    vi.clearAllMocks();
    mockSpawnSync.mockReturnValue({ status: 0, error: null } as ReturnType<typeof spawnSync>);
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true }); });

  function phaseOpts(overrides = {}) {
    return {
      issueNumber: 42,
      planFile: path.join(dir, 'plan.md'),
      workdir: dir,
      config: makeConfig(),
      wikiPath: path.join(dir, 'wiki.jsonl'),
      ciTimeoutSeconds: 10,
      ...overrides,
    };
  }

  // Critical test 3: phase crash → pitfall Learning written + task state = failed
  it('runPlan crash → pitfall Learning written to wiki, returns failed', () => {
    mockSpawnSync.mockReturnValue({ status: 1, error: null } as ReturnType<typeof spawnSync>);

    const opts = phaseOpts();
    const result = runPlan(opts);

    expect(result.outcome).toBe('failed');
    expect(result.learning).toBeDefined();
    expect(result.learning?.type).toBe('pitfall');

    const wiki = readWiki(opts.wikiPath);
    expect(wiki).toHaveLength(1);
    expect(wiki[0].type).toBe('pitfall');
  });

  it('runPlan success → returns success when plan file created', () => {
    mockSpawnSync.mockImplementation((_cmd, _args, options) => {
      // Simulate claude writing the plan file
      const planFile = path.join(dir, 'plan.md');
      fs.writeFileSync(planFile, '# Plan\nSTATUS: ACTION\n## Problem\nBug exists.\n## Approach\n- Fix it\n## Files\n- src/app.ts\n## Risks\n- none\n## Test strategy\n- unit test');
      return { status: 0, error: null } as ReturnType<typeof spawnSync>;
    });

    const result = runPlan(phaseOpts());
    expect(result.outcome).toBe('success');
  });

  it('runReview returns failed when claude exits non-zero', () => {
    mockSpawnSync.mockReturnValue({ status: 1, error: null } as ReturnType<typeof spawnSync>);

    const opts = phaseOpts({ ciTimeoutSeconds: 1 });
    const result = runReview(opts);

    expect(result.outcome).toBe('failed');
    const wiki = readWiki(opts.wikiPath);
    expect(wiki.some(e => e.key.includes('review'))).toBe(true);
  });

  // Critical test 5: runReview timeout behaviour (CI budget)
  it('runReview SIGTERM → timeout learning key, returns failed', () => {
    mockSpawnSync.mockReturnValue({ status: null, signal: 'SIGTERM', error: null } as ReturnType<typeof spawnSync>);

    const opts = phaseOpts({ ciTimeoutSeconds: 1 });
    const result = runReview(opts);

    expect(result.outcome).toBe('failed');
    expect(result.learning?.key).toContain('timeout');
    const wiki = readWiki(opts.wikiPath);
    expect(wiki.some(e => e.key.includes('timeout'))).toBe(true);
  });
});
