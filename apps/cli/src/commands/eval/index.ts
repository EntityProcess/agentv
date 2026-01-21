import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  command,
  flag,
  multioption,
  number,
  option,
  optional,
  positional,
  restPositionals,
  string,
} from 'cmd-ts';
import fg from 'fast-glob';

import { runEvalCommand } from './run-eval.js';

export const evalCommand = command({
  name: 'eval',
  description: 'Run eval suites and report results',
  args: {
    evalPaths: restPositionals({
      type: string,
      displayName: 'eval-paths',
      description: 'Path(s) or glob(s) to evaluation .yaml file(s)',
    }),
    target: option({
      type: string,
      long: 'target',
      description: 'Override target name from targets.yaml',
      defaultValue: () => 'default',
    }),
    targets: option({
      type: optional(string),
      long: 'targets',
      description: 'Path to targets.yaml (overrides discovery)',
    }),
    filter: option({
      type: optional(string),
      long: 'filter',
      description: 'Filter eval cases by ID pattern (glob supported, e.g., "summary-*")',
    }),
    workers: option({
      type: number,
      long: 'workers',
      description:
        'Number of parallel workers (default: 3, max: 50). Can also be set per-target in targets.yaml',
      defaultValue: () => 3,
    }),
    out: option({
      type: optional(string),
      long: 'out',
      description: 'Write results to the specified path',
    }),
    outputFormat: option({
      type: string,
      long: 'output-format',
      description: "Output format: 'jsonl' or 'yaml' (default: jsonl)",
      defaultValue: () => 'jsonl',
    }),
    dryRun: flag({
      long: 'dry-run',
      description: 'Use mock provider responses instead of real LLM calls',
    }),
    dryRunDelay: option({
      type: number,
      long: 'dry-run-delay',
      description:
        'Fixed delay in milliseconds for dry-run mode (overridden by delay range if specified)',
      defaultValue: () => 0,
    }),
    dryRunDelayMin: option({
      type: number,
      long: 'dry-run-delay-min',
      description: 'Minimum delay in milliseconds for dry-run mode (requires --dry-run-delay-max)',
      defaultValue: () => 0,
    }),
    dryRunDelayMax: option({
      type: number,
      long: 'dry-run-delay-max',
      description: 'Maximum delay in milliseconds for dry-run mode (requires --dry-run-delay-min)',
      defaultValue: () => 0,
    }),
    agentTimeout: option({
      type: number,
      long: 'agent-timeout',
      description: 'Timeout in seconds for provider responses (default: 120)',
      defaultValue: () => 120,
    }),
    maxRetries: option({
      type: number,
      long: 'max-retries',
      description: 'Retry count for timeout recoveries (default: 2)',
      defaultValue: () => 2,
    }),
    cache: flag({
      long: 'cache',
      description: 'Enable in-memory provider response cache',
    }),
    verbose: flag({
      long: 'verbose',
      description: 'Enable verbose logging',
    }),
  },
  handler: async (args) => {
    const resolvedPaths = await resolveEvalPaths(args.evalPaths, process.cwd());
    const rawOptions: Record<string, unknown> = {
      target: args.target,
      targets: args.targets,
      filter: args.filter,
      workers: args.workers,
      out: args.out,
      outputFormat: args.outputFormat,
      dryRun: args.dryRun,
      dryRunDelay: args.dryRunDelay,
      dryRunDelayMin: args.dryRunDelayMin,
      dryRunDelayMax: args.dryRunDelayMax,
      agentTimeout: args.agentTimeout,
      maxRetries: args.maxRetries,
      cache: args.cache,
      verbose: args.verbose,
    };
    await runEvalCommand({ testFiles: resolvedPaths, rawOptions });
  },
});

async function resolveEvalPaths(evalPaths: string[], cwd: string): Promise<string[]> {
  const normalizedInputs = evalPaths.map((value) => value?.trim()).filter((value) => value);
  if (normalizedInputs.length === 0) {
    throw new Error('No eval paths provided.');
  }

  const unmatched: string[] = [];
  const results = new Set<string>();

  for (const pattern of normalizedInputs) {
    // If the pattern points to an existing file, short-circuit globbing
    const candidatePath = path.isAbsolute(pattern)
      ? path.normalize(pattern)
      : path.resolve(cwd, pattern);
    try {
      const stats = await stat(candidatePath);
      if (stats.isFile() && /\.(ya?ml|jsonl)$/i.test(candidatePath)) {
        results.add(candidatePath);
        continue;
      }
    } catch {
      // fall through to glob matching
    }

    const globPattern = pattern.includes('\\') ? pattern.replace(/\\/g, '/') : pattern;
    const matches = await fg(globPattern, {
      cwd,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: true,
      followSymbolicLinks: true,
    });

    const yamlMatches = matches.filter((filePath) => /\.(ya?ml|jsonl)$/i.test(filePath));
    if (yamlMatches.length === 0) {
      unmatched.push(pattern);
      continue;
    }

    for (const filePath of yamlMatches) {
      results.add(path.normalize(filePath));
    }
  }

  if (unmatched.length > 0) {
    throw new Error(
      `No eval files matched: ${unmatched.join(
        ', ',
      )}. Provide YAML or JSONL paths or globs (e.g., "evals/**/*.yaml", "evals/**/*.jsonl").`,
    );
  }

  const sorted = Array.from(results);
  sorted.sort();
  return sorted;
}
