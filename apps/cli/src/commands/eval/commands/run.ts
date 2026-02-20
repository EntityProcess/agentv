import { command, flag, number, option, optional, restPositionals, string } from 'cmd-ts';

import { runEvalCommand } from '../run-eval.js';
import { resolveEvalPaths } from '../shared.js';

export const evalRunCommand = command({
  name: 'run',
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
    evalId: option({
      type: optional(string),
      long: 'eval-id',
      description: 'Filter tests by ID pattern (glob supported, e.g., "summary-*")',
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
    keepWorkspaces: flag({
      long: 'keep-workspaces',
      description:
        'Always keep temporary workspaces after evaluation (default: keep on failure only)',
    }),
    cleanupWorkspaces: flag({
      long: 'cleanup-workspaces',
      description: 'Always cleanup temporary workspaces, even on failure',
    }),
    trace: flag({
      long: 'trace',
      description: 'Persist full execution traces to .agentv/traces/ as JSONL',
    }),
  },
  handler: async (args) => {
    // Launch interactive wizard when no eval paths and stdin is a TTY
    if (args.evalPaths.length === 0 && process.stdin.isTTY) {
      const { launchInteractiveWizard } = await import('../interactive.js');
      await launchInteractiveWizard();
      return;
    }

    const resolvedPaths = await resolveEvalPaths(args.evalPaths, process.cwd());
    const rawOptions: Record<string, unknown> = {
      target: args.target,
      targets: args.targets,
      filter: args.evalId,
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
      keepWorkspaces: args.keepWorkspaces,
      cleanupWorkspaces: args.cleanupWorkspaces,
      trace: args.trace,
    };
    await runEvalCommand({ testFiles: resolvedPaths, rawOptions });
  },
});
