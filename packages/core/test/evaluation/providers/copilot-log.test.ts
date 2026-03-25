import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CopilotLogProvider } from '../../../src/evaluation/providers/copilot-log.js';

/** Build a JSONL event line with data nesting matching real Copilot CLI format. */
function eventLine(type: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, data, id: 'evt-1', timestamp: '2026-03-25T10:00:00.000Z' });
}

describe('CopilotLogProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'copilot-log-provider-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createSession(sessionId: string, events: string) {
    const sessionDir = path.join(tempDir, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'workspace.yaml'), 'cwd: /projects/app\n');
    await writeFile(path.join(sessionDir, 'events.jsonl'), events);
    return sessionDir;
  }

  it('reads transcript from explicit session_dir', async () => {
    const sessionDir = await createSession(
      's1',
      [
        eventLine('user.message', { content: 'hello' }),
        eventLine('assistant.message', { content: 'hi', toolRequests: [] }),
      ].join('\n'),
    );

    const provider = new CopilotLogProvider('test', { sessionDir });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.output).toBeDefined();
    expect(response.output?.length).toBeGreaterThan(0);
    expect(response.output?.[0].role).toBe('user');
    expect(response.output?.[0].content).toBe('hello');
  });

  it('reads transcript from session_id + session_state_dir', async () => {
    await createSession(
      'uuid-abc',
      [eventLine('user.message', { content: 'test input' })].join('\n'),
    );

    const provider = new CopilotLogProvider('test', {
      sessionId: 'uuid-abc',
      sessionStateDir: tempDir,
    });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.output).toBeDefined();
    expect(response.output?.[0].content).toBe('test input');
  });

  it('auto-discovers latest session with discover=latest', async () => {
    await createSession('uuid-old', [eventLine('user.message', { content: 'old' })].join('\n'));
    await new Promise((r) => setTimeout(r, 50));
    await createSession('uuid-new', [eventLine('user.message', { content: 'new' })].join('\n'));

    const provider = new CopilotLogProvider('test', {
      discover: 'latest',
      sessionStateDir: tempDir,
    });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.output).toBeDefined();
    expect(response.output?.[0].content).toBe('new');
  });

  it('returns token usage from session.shutdown modelMetrics', async () => {
    const sessionDir = await createSession(
      's1',
      [
        eventLine('session.shutdown', {
          shutdownType: 'normal',
          currentModel: 'gpt-4o',
          modelMetrics: {
            'gpt-4o': { usage: { inputTokens: 500, outputTokens: 200 } },
          },
        }),
      ].join('\n'),
    );

    const provider = new CopilotLogProvider('test', { sessionDir });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.tokenUsage).toEqual({ input: 500, output: 200 });
  });

  it('throws when no session found', async () => {
    const provider = new CopilotLogProvider('test', {
      sessionId: 'nonexistent',
      sessionStateDir: tempDir,
    });

    await expect(provider.invoke({ question: 'x' })).rejects.toThrow();
  });

  it('has correct provider metadata', () => {
    const provider = new CopilotLogProvider('my-target', { sessionDir: '/tmp/s1' });
    expect(provider.id).toBe('copilot-log:my-target');
    expect(provider.kind).toBe('copilot-log');
    expect(provider.targetName).toBe('my-target');
  });
});
