import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join(homedir(), '.agentv', 'trace-state');

export interface SessionState {
  sessionId: string;
  rootSpanTraceId: string;
  rootSpanId: string;
  currentTurnSpanId?: string;
  turnCount: number;
  toolCount: number;
  startedAt: string;
}

export async function loadState(sessionId: string): Promise<SessionState | null> {
  try {
    const data = await readFile(join(STATE_DIR, `${sessionId}.json`), 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveState(state: SessionState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  const filePath = join(STATE_DIR, `${state.sessionId}.json`);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2));
  await rename(tmpPath, filePath);
}

export async function deleteState(sessionId: string): Promise<void> {
  try {
    await unlink(join(STATE_DIR, `${sessionId}.json`));
  } catch {
    /* ignore if already deleted */
  }
}

export async function cleanupStaleStates(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const files = await readdir(STATE_DIR);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(await readFile(join(STATE_DIR, file), 'utf8'));
        if (data.startedAt && now - new Date(data.startedAt).getTime() > maxAgeMs) {
          await unlink(join(STATE_DIR, file));
        }
      } catch {
        /* skip corrupted files */
      }
    }
  } catch {
    /* STATE_DIR might not exist */
  }
}
