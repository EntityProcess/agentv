/**
 * Project sync — pulls remote Git repos to the local path declared in the
 * project registry before Dashboard/eval startup.
 *
 * Sync is oneshot only, triggered by the Dashboard UI "Sync" button or the
 * `agentv project sync` CLI command. There is no daemon or continuous mode.
 *
 *   First run  — git clone --depth 1 --filter=blob:none --branch <ref> <repoUrl> <path>
 *   Subsequent — git pull --ff-only (when <path>/.git already exists)
 *
 * Usage:
 *   import { syncProjects } from './project-sync.js';
 *   await syncProjects(registry.projects);
 */

import * as childProcess from 'node:child_process';
import { existsSync } from 'node:fs';

import type { ProjectEntry } from './projects.js';

/**
 * Clone or pull a single project entry from its declared repo URL.
 * - No .git present: shallow clone into entry.path.
 * - .git present: git pull --ff-only to update in place.
 * Throws on git error or missing repoUrl/ref.
 */
export async function syncProject(entry: ProjectEntry): Promise<void> {
  if (!entry.repoUrl) {
    throw new Error(`Project '${entry.id}' has no repo.url defined`);
  }
  if (!entry.ref) {
    throw new Error(`Project '${entry.id}' has no repo.branch defined`);
  }
  const dest = entry.path;

  if (existsSync(`${dest}/.git`)) {
    childProcess.execFileSync('git', ['-C', dest, 'pull', '--ff-only'], { stdio: 'inherit' });
  } else {
    childProcess.execFileSync(
      'git',
      ['clone', '--depth', '1', '--filter=blob:none', '--branch', entry.ref, entry.repoUrl, dest],
      { stdio: 'inherit' },
    );
  }
}

/**
 * Iterate project entries and sync any that have a repo URL declared.
 * Entries without repoUrl are skipped silently.
 */
export async function syncProjects(entries: ProjectEntry[]): Promise<void> {
  for (const entry of entries) {
    if (!entry.repoUrl) continue;
    console.log(`Syncing project '${entry.id}' from ${entry.repoUrl}...`);
    await syncProject(entry);
    console.log(`Project '${entry.id}' synced.`);
  }
}
