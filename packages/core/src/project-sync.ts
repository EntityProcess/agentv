/**
 * Project sync — pulls remote GitHub repos to the local path declared in the
 * project registry before Dashboard/eval startup.
 *
 * Sync is oneshot only, triggered by the Dashboard UI "Sync" button or the
 * `agentv project sync` CLI command. There is no daemon or continuous mode.
 *
 *   First run  — git clone --depth 1 --filter=blob:none --branch <ref> <url> <path>
 *   Subsequent — git pull --ff-only (when <path>/.git already exists)
 *
 * Usage:
 *   import { syncProjects } from './project-sync.js';
 *   await syncProjects(registry.projects);
 */

import * as childProcess from 'node:child_process';
import { existsSync } from 'node:fs';

import type { ProjectEntry } from './projects.js';

export function resolveGitHubRepositoryUrl(repository: string): string {
  return `https://github.com/${repository.trim().replace(/\.git$/, '')}.git`;
}

/**
 * Clone or pull a single project entry from its declared repository.
 * - No .git present: shallow clone into entry.path.
 * - .git present: git pull --ff-only to update in place.
 * Throws on git error or missing repository/ref.
 */
export async function syncProject(entry: ProjectEntry): Promise<void> {
  if (!entry.repository) {
    throw new Error(`Project '${entry.id}' has no repository defined`);
  }
  if (!entry.ref) {
    throw new Error(`Project '${entry.id}' has no ref defined`);
  }
  const url = resolveGitHubRepositoryUrl(entry.repository);
  const dest = entry.path;

  if (existsSync(`${dest}/.git`)) {
    childProcess.execFileSync('git', ['-C', dest, 'pull', '--ff-only'], { stdio: 'inherit' });
  } else {
    childProcess.execFileSync(
      'git',
      ['clone', '--depth', '1', '--filter=blob:none', '--branch', entry.ref, url, dest],
      { stdio: 'inherit' },
    );
  }
}

/**
 * Iterate project entries and sync any that have a repository declared.
 * Entries without repository are skipped silently.
 */
export async function syncProjects(entries: ProjectEntry[]): Promise<void> {
  for (const entry of entries) {
    if (!entry.repository) continue;
    console.log(`Syncing project '${entry.id}' from ${entry.repository}...`);
    await syncProject(entry);
    console.log(`Project '${entry.id}' synced.`);
  }
}
