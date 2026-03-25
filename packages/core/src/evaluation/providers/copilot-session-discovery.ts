/**
 * Copilot CLI session discovery.
 *
 * Scans ~/.copilot/session-state/ for session directories containing
 * workspace.yaml and events.jsonl. Returns sessions sorted by recency.
 *
 * Each session directory is a UUID containing:
 *   workspace.yaml  — session metadata (cwd, repository)
 *   events.jsonl    — event transcript
 *
 * To extend filtering:
 *   1. Add a new option to DiscoverOptions
 *   2. Add filter logic in the sessions.filter() chain
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CopilotSession {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly cwd: string;
  readonly repository?: string;
  readonly updatedAt: Date;
  readonly isActive: boolean;
}

export interface DiscoverOptions {
  /** Filter sessions by working directory (exact match). */
  readonly cwd?: string;
  /** Filter sessions by repository name (exact match). */
  readonly repository?: string;
  /** Maximum number of sessions to return (default: 10). */
  readonly limit?: number;
  /** Override the default ~/.copilot/session-state directory. */
  readonly sessionStateDir?: string;
}

const DEFAULT_SESSION_STATE_DIR = () => path.join(homedir(), '.copilot', 'session-state');

export async function discoverCopilotSessions(opts?: DiscoverOptions): Promise<CopilotSession[]> {
  const sessionStateDir = opts?.sessionStateDir ?? DEFAULT_SESSION_STATE_DIR();
  const limit = opts?.limit ?? 10;

  let entries: string[];
  try {
    entries = await readdir(sessionStateDir);
  } catch {
    return [];
  }

  const sessions: CopilotSession[] = [];

  for (const entry of entries) {
    const sessionDir = path.join(sessionStateDir, entry);
    const workspacePath = path.join(sessionDir, 'workspace.yaml');
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    try {
      const workspaceContent = await readFile(workspacePath, 'utf8');
      const workspace = parseSimpleYaml(workspaceContent);

      const cwd = String(workspace.cwd ?? '');

      let updatedAt: Date;
      try {
        const eventsStat = await stat(eventsPath);
        updatedAt = eventsStat.mtime;
      } catch {
        updatedAt = new Date(0);
      }

      // Check whether the session has ended by looking for "session.shutdown"
      // in the last 4 KB of the events file. The shutdown event is always the
      // final event, so reading only the tail avoids loading multi-MB transcripts.
      let isActive = true;
      try {
        const fd = await import('node:fs/promises').then((fs) => fs.open(eventsPath, 'r'));
        try {
          const fstat = await fd.stat();
          const tailSize = Math.min(fstat.size, 4096);
          const buf = Buffer.alloc(tailSize);
          await fd.read(buf, 0, tailSize, Math.max(0, fstat.size - tailSize));
          isActive = !buf.toString('utf8').includes('"session.shutdown"');
        } finally {
          await fd.close();
        }
      } catch {
        // No events file — treat as active
      }

      sessions.push({
        sessionId: entry,
        sessionDir,
        cwd,
        repository: workspace.repository ? String(workspace.repository) : undefined,
        updatedAt,
        isActive,
      });
    } catch {}
  }

  let filtered = sessions;
  if (opts?.cwd) {
    filtered = filtered.filter((s) => s.cwd === opts.cwd);
  }
  if (opts?.repository) {
    filtered = filtered.filter((s) => s.repository === opts.repository);
  }

  filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return filtered.slice(0, limit);
}

/**
 * Minimal YAML parser for workspace.yaml files.
 * Only handles flat key: value pairs (no nesting, no arrays).
 * Nested or multi-line values will be captured as partial strings
 * (everything after the first colon on that line).
 */
function parseSimpleYaml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
