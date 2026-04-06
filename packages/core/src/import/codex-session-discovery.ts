/**
 * Codex CLI session discovery.
 *
 * Scans ~/.codex/sessions/ for rollout JSONL files. Codex CLI stores sessions at:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
 *
 * Sessions are returned sorted by modification time (most recent first).
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CodexSession {
  /** UUID from the filename */
  readonly sessionId: string;
  /** Full path to the JSONL file */
  readonly filePath: string;
  /** Filename (e.g., rollout-2026-03-29T14-22-01-<uuid>.jsonl) */
  readonly filename: string;
  /** Last modification time */
  readonly updatedAt: Date;
}

export interface CodexDiscoverOptions {
  /** Filter by date string (YYYY-MM-DD). */
  readonly date?: string;
  /** Maximum number of sessions to return (default: 10). */
  readonly limit?: number;
  /** Override the default ~/.codex/sessions directory. */
  readonly sessionsDir?: string;
  /** Return only the most recent session. */
  readonly latest?: boolean;
}

const DEFAULT_SESSIONS_DIR = () => path.join(homedir(), '.codex', 'sessions');

export async function discoverCodexSessions(opts?: CodexDiscoverOptions): Promise<CodexSession[]> {
  const sessionsDir = opts?.sessionsDir ?? DEFAULT_SESSIONS_DIR();
  const limit = opts?.latest ? 1 : (opts?.limit ?? 10);

  const sessions: CodexSession[] = [];

  // Walk YYYY/MM/DD directory structure
  let yearDirs: string[];
  try {
    yearDirs = await readdir(sessionsDir);
  } catch {
    return [];
  }

  for (const year of yearDirs) {
    const yearPath = path.join(sessionsDir, year);
    let monthDirs: string[];
    try {
      monthDirs = await readdir(yearPath);
    } catch {
      continue;
    }

    for (const month of monthDirs) {
      const monthPath = path.join(yearPath, month);
      let dayDirs: string[];
      try {
        dayDirs = await readdir(monthPath);
      } catch {
        continue;
      }

      for (const day of dayDirs) {
        // Filter by date if specified
        if (opts?.date) {
          const dirDate = `${year}-${month}-${day}`;
          if (dirDate !== opts.date) continue;
        }

        const dayPath = path.join(monthPath, day);
        let files: string[];
        try {
          files = await readdir(dayPath);
        } catch {
          continue;
        }

        for (const file of files) {
          if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue;

          const filePath = path.join(dayPath, file);

          // Extract UUID from filename: rollout-<timestamp>-<uuid>.jsonl
          // UUID is the last segment before .jsonl
          const nameWithoutExt = file.replace(/\.jsonl$/, '');
          const parts = nameWithoutExt.split('-');
          // UUID is typically the last 5 hyphen-separated segments (standard UUID format)
          const sessionId = parts.length >= 6 ? parts.slice(-5).join('-') : nameWithoutExt;

          let updatedAt: Date;
          try {
            const fileStat = await stat(filePath);
            updatedAt = fileStat.mtime;
          } catch {
            updatedAt = new Date(0);
          }

          sessions.push({ sessionId, filePath, filename: file, updatedAt });
        }
      }
    }
  }

  sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return sessions.slice(0, limit);
}
