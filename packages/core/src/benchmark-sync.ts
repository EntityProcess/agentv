/**
 * Benchmark sync — pulls remote git repos to the local path declared in the
 * benchmark registry before Studio/eval startup.
 *
 * Sync is oneshot only, triggered by the Studio UI "Sync" button or the
 * `agentv benchmark sync` CLI command. There is no daemon or continuous mode.
 *
 *   First run  — git clone --depth 1 --filter=blob:none --branch <ref> <url> <path>
 *   Subsequent — git pull --ff-only (when <path>/.git already exists)
 *
 * Usage:
 *   import { syncBenchmarks } from './benchmark-sync.js';
 *   await syncBenchmarks(registry.benchmarks);
 */

import * as childProcess from 'node:child_process';
import { existsSync } from 'node:fs';

import type { BenchmarkEntry } from './benchmarks.js';

/**
 * Clone or pull a single benchmark entry from its declared source.
 * - No .git present: shallow clone into entry.path.
 * - .git present: git pull --ff-only to update in place.
 * Throws on git error or missing source.
 */
export async function syncBenchmark(entry: BenchmarkEntry): Promise<void> {
  if (!entry.source) {
    throw new Error(`Benchmark '${entry.id}' has no source defined`);
  }
  const { url, ref } = entry.source;
  const dest = entry.path;

  if (existsSync(`${dest}/.git`)) {
    childProcess.execFileSync('git', ['-C', dest, 'pull', '--ff-only'], { stdio: 'inherit' });
  } else {
    childProcess.execFileSync(
      'git',
      ['clone', '--depth', '1', '--filter=blob:none', '--branch', ref, url, dest],
      { stdio: 'inherit' },
    );
  }
}

/**
 * Iterate benchmark entries and sync any that have a source declared.
 * Entries without source are skipped silently.
 */
export async function syncBenchmarks(entries: BenchmarkEntry[]): Promise<void> {
  for (const entry of entries) {
    if (!entry.source) continue;
    console.log(`Syncing benchmark '${entry.id}' from ${entry.source.url}...`);
    await syncBenchmark(entry);
    console.log(`Benchmark '${entry.id}' synced.`);
  }
}
