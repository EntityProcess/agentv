import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverCopilotSessions } from '../../../src/evaluation/providers/copilot-session-discovery.js';

describe('discoverCopilotSessions', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'copilot-discovery-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createSession(sessionId: string, workspaceYaml: string, eventsJsonl = '') {
    const sessionDir = path.join(tempDir, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'workspace.yaml'), workspaceYaml);
    if (eventsJsonl) {
      await writeFile(path.join(sessionDir, 'events.jsonl'), eventsJsonl);
    }
    return sessionDir;
  }

  it('discovers sessions in session-state directory', async () => {
    await createSession('uuid-1', 'cwd: /projects/app\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /projects/app\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    expect(sessions).toHaveLength(2);
  });

  it('filters sessions by cwd', async () => {
    await createSession('uuid-1', 'cwd: /projects/app\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /projects/other\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({
      sessionStateDir: tempDir,
      cwd: '/projects/app',
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('uuid-1');
  });

  it('filters sessions by repository', async () => {
    await createSession('uuid-1', 'cwd: /a\nrepository: org/repo\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /b\nrepository: org/other\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({
      sessionStateDir: tempDir,
      repository: 'org/repo',
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('uuid-1');
  });

  it('sorts sessions by updatedAt descending', async () => {
    await createSession('uuid-old', 'cwd: /app\n', '{"type":"session.start"}\n');
    // Small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    await createSession('uuid-new', 'cwd: /app\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    expect(sessions[0].sessionId).toBe('uuid-new');
  });

  it('respects limit parameter', async () => {
    await createSession('uuid-1', 'cwd: /app\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /app\n', '{"type":"session.start"}\n');
    await createSession('uuid-3', 'cwd: /app\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({
      sessionStateDir: tempDir,
      limit: 2,
    });
    expect(sessions).toHaveLength(2);
  });

  it('detects active sessions (no session.shutdown)', async () => {
    await createSession('uuid-active', 'cwd: /app\n', '{"type":"session.start"}\n');
    await createSession(
      'uuid-done',
      'cwd: /app\n',
      '{"type":"session.start"}\n{"type":"session.shutdown"}\n',
    );

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    const active = sessions.find((s) => s.sessionId === 'uuid-active');
    const done = sessions.find((s) => s.sessionId === 'uuid-done');
    expect(active?.isActive).toBe(true);
    expect(done?.isActive).toBe(false);
  });

  it('returns empty array for nonexistent directory', async () => {
    const sessions = await discoverCopilotSessions({
      sessionStateDir: '/nonexistent/path',
    });
    expect(sessions).toEqual([]);
  });

  it('skips directories without workspace.yaml', async () => {
    const sessionDir = path.join(tempDir, 'uuid-broken');
    await mkdir(sessionDir, { recursive: true });
    // No workspace.yaml — should be skipped

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    expect(sessions).toEqual([]);
  });
});
