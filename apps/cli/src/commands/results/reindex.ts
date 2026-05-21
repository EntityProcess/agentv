/**
 * `agentv results reindex` — rebuild index/runs.jsonl from the existing run tree.
 *
 * Use this once to backfill the index after upgrading an existing results repo.
 * After the first push following the upgrade, new runs are appended automatically.
 *
 * How it works:
 *   1. Fetch/pull the latest state of the results repo.
 *   2. Walk all run directories via listResultFilesFromRunsDir.
 *   3. Read each run's first JSONL result to extract target/experiment.
 *   4. Write a complete index/runs.jsonl and commit+push it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { command, flag, option, optional, string } from 'cmd-ts';

import {
  type ResultsConfig,
  type RunIndexEntry,
  loadConfig,
  normalizeResultsConfig,
  reindexResultsRepo,
  resolveResultsRepoRunsDir,
} from '@agentv/core';

import { findRepoRoot } from '../eval/shared.js';
import { listResultFilesFromRunsDir } from '../inspect/utils.js';

async function loadNormalizedResultsConfig(
  cwd: string,
): Promise<Required<ResultsConfig> | undefined> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd;
  const config = await loadConfig(path.join(cwd, '_'), repoRoot);
  if (!config?.results) return undefined;
  return normalizeResultsConfig(config.results);
}

export const resultsReindexCommand = command({
  name: 'reindex',
  description:
    'Backfill index/runs.jsonl in the results repo from the existing run tree (migration helper)',
  args: {
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
    dryRun: flag({
      long: 'dry-run',
      description: 'Print the entries that would be written without committing',
    }),
  },
  handler: async ({ dir, dryRun }) => {
    const cwd = dir ?? process.cwd();
    const config = await loadNormalizedResultsConfig(cwd);
    if (!config) {
      console.error(
        'Error: No results repo configured. Add a results section to .agentv/config.yaml',
      );
      process.exit(1);
    }

    const runsDir = resolveResultsRepoRunsDir(config);
    console.log(`Scanning runs from ${runsDir}…`);
    const metas = listResultFilesFromRunsDir(runsDir);

    const entries: RunIndexEntry[] = [];

    for (const meta of metas) {
      let target = '';
      const sepIdx = meta.filename.indexOf('::');
      let experiment = sepIdx === -1 ? 'default' : meta.filename.slice(0, sepIdx);

      try {
        const content = readFileSync(meta.path, 'utf8');
        const firstLine = content.split('\n').find((l) => l.trim());
        if (firstLine) {
          const first = JSON.parse(firstLine) as {
            target?: string;
            experiment?: string;
          };
          if (first.target) target = first.target;
          if (first.experiment) experiment = first.experiment;
        }
      } catch {
        // skip unreadable manifests
      }

      const passed = Math.round(meta.passRate * meta.testCount);

      entries.push({
        run_id: meta.filename,
        timestamp: meta.timestamp,
        experiment,
        target,
        test_count: meta.testCount,
        passed,
        pass_rate: meta.passRate,
        avg_score: meta.avgScore,
        size_bytes: meta.sizeBytes,
        tags: [],
      });
    }

    if (dryRun) {
      console.log(`Would write ${entries.length} entries to index/runs.jsonl:`);
      for (const e of entries) {
        console.log(` ${e.run_id} (${e.test_count} tests, pass_rate=${e.pass_rate.toFixed(2)})`);
      }
      return;
    }

    const written = await reindexResultsRepo({ config, entries });
    if (written === 0) {
      console.log('Index is already up to date — no changes committed.');
    } else {
      console.log(`Reindexed ${written} runs and pushed index/runs.jsonl to ${config.repo}.`);
    }
  },
});
