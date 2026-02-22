import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type SessionState,
  cleanupStaleStates,
  deleteState,
  loadState,
  saveState,
} from '../lib/state.js';

const STATE_DIR = join(homedir(), '.agentv', 'trace-state');

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'test-session-123',
    rootSpanTraceId: 'aaaa',
    rootSpanId: 'bbbb',
    turnCount: 0,
    toolCount: 0,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(async () => {
  await deleteState('test-session-123');
  await deleteState('stale-session');
  await deleteState('fresh-session');
});

describe('state management', () => {
  it('saves and loads state', async () => {
    const state = makeState();
    await saveState(state);

    const loaded = await loadState('test-session-123');
    expect(loaded).toEqual(state);
  });

  it('returns null for missing state', async () => {
    const loaded = await loadState('nonexistent');
    expect(loaded).toBeNull();
  });

  it('deletes state', async () => {
    const state = makeState();
    await saveState(state);
    await deleteState('test-session-123');

    const loaded = await loadState('test-session-123');
    expect(loaded).toBeNull();
  });

  it('delete is idempotent', async () => {
    // Should not throw for missing files
    await deleteState('nonexistent');
  });

  it('writes atomically (temp file then rename)', async () => {
    const state = makeState();
    await saveState(state);

    // Verify the file exists at the expected path
    const filePath = join(STATE_DIR, 'test-session-123.json');
    const data = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    expect(parsed.sessionId).toBe('test-session-123');
  });

  it('updates state in place', async () => {
    const state = makeState();
    await saveState(state);

    state.turnCount = 5;
    state.toolCount = 12;
    state.currentTurnSpanId = 'cccc';
    await saveState(state);

    const loaded = await loadState('test-session-123');
    expect(loaded?.turnCount).toBe(5);
    expect(loaded?.toolCount).toBe(12);
    expect(loaded?.currentTurnSpanId).toBe('cccc');
  });

  it('cleans up stale states', async () => {
    // Create a stale state (started 2 days ago)
    const stale = makeState({
      sessionId: 'stale-session',
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await saveState(stale);

    // Create a fresh state
    const fresh = makeState({
      sessionId: 'fresh-session',
      startedAt: new Date().toISOString(),
    });
    await saveState(fresh);

    await cleanupStaleStates();

    expect(await loadState('stale-session')).toBeNull();
    expect(await loadState('fresh-session')).not.toBeNull();
  });
});
