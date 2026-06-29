/**
 * `agentv results combine` — combine partial local run workspaces into one
 * canonical local run.
 *
 * Duplicate rows are keyed by `(test_id, target)`. Non-interactive usage
 * defaults to `error`; interactive usage defaults to prompting per duplicate
 * with an apply-to-all shortcut.
 */

import * as readline from 'node:readline/promises';
import { command, oneOf, option, optional, restPositionals, string } from 'cmd-ts';

import {
  type CombineDuplicatePolicy,
  type CombineRunSource,
  buildCombineRunSources,
  combineRunSources,
  inspectRunSourceDuplicates,
} from './combine-run.js';

export async function collectPromptDuplicateChoices(
  conflicts: ReturnType<typeof inspectRunSourceDuplicates>,
  ask: (message: string) => Promise<string>,
): Promise<Map<string, 'keep' | 'replace'>> {
  const choices = new Map<string, 'keep' | 'replace'>();
  let applyToAll: 'keep' | 'replace' | undefined;
  for (const conflict of conflicts) {
    if (choices.has(conflict.key)) continue;
    if (applyToAll) {
      choices.set(conflict.key, applyToAll);
      continue;
    }

    console.log(
      `Duplicate ${conflict.test_id} / ${conflict.target}: kept ${conflict.kept_source_id}, latest is ${conflict.latest_source_id}.`,
    );
    const answer = (await ask('Replace with latest? [y]es/[n]o/[a]ll latest/[k]eep all: '))
      .trim()
      .toLowerCase();
    if (answer === 'a' || answer === 'all') {
      applyToAll = 'replace';
    } else if (answer === 'k' || answer === 'keep') {
      applyToAll = 'keep';
    }
    const choice = applyToAll ?? (answer === 'y' || answer === 'yes' ? 'replace' : 'keep');
    choices.set(conflict.key, choice);
  }
  return choices;
}

async function promptDuplicateChoices(
  conflicts: ReturnType<typeof inspectRunSourceDuplicates>,
): Promise<Map<string, 'keep' | 'replace'>> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await collectPromptDuplicateChoices(conflicts, (message) => rl.question(message));
  } finally {
    rl.close();
  }
}

function defaultDuplicatePolicy(
  policy: CombineDuplicatePolicy | undefined,
): CombineDuplicatePolicy {
  if (policy) return policy;
  return process.stdin.isTTY && process.stdout.isTTY ? 'prompt' : 'error';
}

function parseDuplicatePolicy(policy: string | undefined): CombineDuplicatePolicy | undefined {
  if (policy === 'prompt' || policy === 'error' || policy === 'latest') {
    return policy;
  }
  return undefined;
}

function uniqueSourceExperiments(sources: readonly CombineRunSource[]): string[] {
  return [...new Set(sources.map((source) => source.experiment))].sort();
}

async function promptExperimentName(experiments: readonly string[]): Promise<string | undefined> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Source runs span experiments (${experiments.join(', ')}). New experiment name: `,
    );
    return answer.trim() || undefined;
  } finally {
    rl.close();
  }
}

export const resultsCombineCommand = command({
  name: 'combine',
  description: 'Combine two or more partial local run workspaces into a new run workspace',
  args: {
    sources: restPositionals({
      type: string,
      displayName: 'source',
      description: 'Run workspace directory or run manifest',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description:
        'Output run workspace directory (defaults to .agentv/results/<experiment>/<earliest-source-time>)',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description:
        'Experiment namespace for the combined run. Required when sources span multiple experiments.',
    }),
    displayName: option({
      type: optional(string),
      long: 'display-name',
      description: 'Display name stored in summary.json metadata',
    }),
    duplicatePolicy: option({
      type: optional(oneOf(['prompt', 'error', 'latest'])),
      long: 'duplicate-policy',
      description:
        'How to handle duplicate (test_id, target) rows: prompt interactively, error, or keep the latest timestamp',
    }),
  },
  handler: async (args) => {
    if (args.sources.length < 2) {
      console.error('Error: provide at least two run workspaces or run manifests');
      process.exit(1);
    }

    const cwd = process.cwd();
    const sources = buildCombineRunSources(args.sources, cwd);
    const sourceExperiments = uniqueSourceExperiments(sources);
    let experiment = args.experiment;
    if (
      !experiment &&
      sourceExperiments.length > 1 &&
      process.stdin.isTTY &&
      process.stdout.isTTY
    ) {
      experiment = await promptExperimentName(sourceExperiments);
    }
    if (!experiment && sourceExperiments.length > 1) {
      console.error(
        `Error: combining runs from multiple experiments requires --experiment <name>. Source experiments: ${sourceExperiments.join(', ')}`,
      );
      process.exit(1);
    }
    const duplicatePolicy = defaultDuplicatePolicy(parseDuplicatePolicy(args.duplicatePolicy));
    let promptChoices: Map<string, 'keep' | 'replace'> | undefined;

    if (duplicatePolicy === 'prompt') {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(
          'Error: --duplicate-policy prompt requires an interactive terminal; use --duplicate-policy error or latest',
        );
        process.exit(1);
      }
      const conflicts = inspectRunSourceDuplicates(sources);
      if (conflicts.length > 0) {
        promptChoices = await promptDuplicateChoices(conflicts);
      }
    }

    try {
      const result = combineRunSources({
        cwd,
        sources,
        outputDir: args.output,
        experiment,
        displayName: args.displayName,
        duplicatePolicy,
        promptChoices,
      });
      console.log(`Combined ${result.testCount} result row(s) into ${result.runDir}`);
      console.log(`  Run ID: ${result.runId}`);
      console.log(`  Summary: ${result.summaryPath}`);
      if (result.duplicateConflicts.length > 0) {
        console.log(`  Duplicates handled: ${result.duplicateConflicts.length}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  },
});
