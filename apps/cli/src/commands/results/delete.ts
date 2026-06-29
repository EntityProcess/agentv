/**
 * `agentv results delete` — remove one or more local run workspaces.
 *
 * The command requires confirmation unless `--yes` is passed. It accepts local
 * run IDs, run workspace directories, or run manifests and refuses
 * remote runs.
 */

import * as readline from 'node:readline/promises';
import { command, flag, restPositionals, string } from 'cmd-ts';

import { deleteLocalRun, resolveDeleteRunTarget } from './delete-run.js';

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export const resultsDeleteCommand = command({
  name: 'delete',
  description: 'Delete one or more local run workspaces',
  args: {
    runs: restPositionals({
      type: string,
      displayName: 'run',
      description: 'Local run ID, run workspace directory, or run manifest',
    }),
    yes: flag({
      long: 'yes',
      short: 'y',
      description: 'Skip confirmation prompt',
    }),
  },
  handler: async ({ runs, yes }) => {
    if (runs.length === 0) {
      console.error('Error: provide at least one local run ID or run workspace path');
      process.exit(1);
    }

    const cwd = process.cwd();
    try {
      const targets = runs.map((run) => resolveDeleteRunTarget(cwd, run));
      if (!yes) {
        const confirmed = await confirm(`Delete ${targets.length} local run workspace(s)?`);
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      for (const run of runs) {
        const deleted = deleteLocalRun(cwd, run);
        console.log(`Deleted ${deleted.runId}: ${deleted.runDir}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  },
});
