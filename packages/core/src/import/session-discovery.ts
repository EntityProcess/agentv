/**
 * Claude Code session discovery.
 *
 * Scans ~/.claude/projects/ for session JSONL files. Claude Code stores
 * sessions at:
 *   ~/.claude/projects/<encoded-project-path>/<uuid>.jsonl
 *
 * Where <encoded-project-path> is the absolute project path with `/` replaced
 * by `-` and prefixed with `-` (e.g., `-home-user-myproject`).
 *
 * Sessions are returned sorted by modification time (most recent first).
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface ClaudeSession {
  /** UUID of the session */
  readonly sessionId: string;
  /** Full path to the JSONL file */
  readonly filePath: string;
  /** Encoded project directory name */
  readonly projectDir: string;
  /** Last modification time */
  readonly updatedAt: Date;
}

export interface ClaudeDiscoverOptions {
  /** Filter by session UUID (exact match). */
  readonly sessionId?: string;
  /** Filter by project path (substring match against encoded dir name). */
  readonly projectPath?: string;
  /** Maximum number of sessions to return (default: 10). */
  readonly limit?: number;
  /** Override the default ~/.claude/projects directory. */
  readonly projectsDir?: string;
  /** Return only the most recent session. */
  readonly latest?: boolean;
}

const DEFAULT_PROJECTS_DIR = () => path.join(homedir(), '.claude', 'projects');

/**
 * Encode a filesystem path to Claude Code's project directory format.
 * `/home/user/myproject` → `-home-user-myproject`
 */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

export async function discoverClaudeSessions(
  opts?: ClaudeDiscoverOptions,
): Promise<ClaudeSession[]> {
  const projectsDir = opts?.projectsDir ?? DEFAULT_PROJECTS_DIR();
  const limit = opts?.latest ? 1 : (opts?.limit ?? 10);

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  // Filter project directories if projectPath is specified
  if (opts?.projectPath) {
    const encoded = encodeProjectPath(opts.projectPath);
    projectDirs = projectDirs.filter((dir) => dir === encoded || dir.includes(encoded));
  }

  const sessions: ClaudeSession[] = [];

  for (const projectDir of projectDirs) {
    const dirPath = path.join(projectsDir, projectDir);

    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;

      const sessionId = entry.replace(/\.jsonl$/, '');

      // Filter by session ID if specified
      if (opts?.sessionId && sessionId !== opts.sessionId) continue;

      const filePath = path.join(dirPath, entry);

      let updatedAt: Date;
      try {
        const fileStat = await stat(filePath);
        updatedAt = fileStat.mtime;
      } catch {
        updatedAt = new Date(0);
      }

      sessions.push({
        sessionId,
        filePath,
        projectDir,
        updatedAt,
      });
    }
  }

  // Sort by modification time, most recent first
  sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return sessions.slice(0, limit);
}
