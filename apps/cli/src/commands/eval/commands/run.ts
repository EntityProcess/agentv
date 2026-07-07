import {
  array,
  command,
  flag,
  multioption,
  number,
  option,
  optional,
  restPositionals,
  string,
} from 'cmd-ts';

import { runEvalCommand } from '../run-eval.js';

export const evalRunCommand = command({
  name: 'eval',
  description: 'Run eval suites and report results',
  args: {
    evalPaths: restPositionals({
      type: string,
      displayName: 'eval-paths',
      description: 'Path(s) or glob(s) to evaluation files (.yaml, .eval.ts)',
    }),
    provider: multioption({
      type: array(string),
      long: 'provider',
      description:
        'Override provider label(s) from providers.yaml (repeatable for matrix evaluation)',
    }),
    providers: option({
      type: optional(string),
      long: 'providers',
      description: 'Path to providers.yaml (overrides discovery)',
    }),
    target: multioption({
      type: array(string),
      long: 'target',
      description: '[Removed: use --provider <label>] Former target selector',
    }),
    targets: option({
      type: optional(string),
      long: 'targets',
      description: '[Removed: use --providers <path>] Former providers.yaml path',
    }),
    testId: multioption({
      type: array(string),
      long: 'test-id',
      description: 'Filter tests by ID pattern (repeatable, OR logic; glob supported)',
    }),
    workers: option({
      type: optional(number),
      long: 'workers',
      description:
        'Number of parallel test cases within each eval file (default: 3, max: 50). Eval files always run sequentially. Can also be set per-provider in providers.yaml',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      description: '[Removed: use --output <dir>] Former flat result path',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description:
        'Run artifact directory (writes index.jsonl, summary.json, and per-case artifacts)',
    }),
    outputFormat: option({
      type: optional(string),
      long: 'output-format',
      description: '[Removed] Run directories always write index.jsonl',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Experiment label for canonical run output (default: default)',
    }),
    resultsRepo: option({
      type: optional(string),
      long: 'results-repo',
      description:
        'Results Git repo override: current/. for the source repo, a local path, Git URL, or owner/repo',
    }),
    resultsBranch: option({
      type: optional(string),
      long: 'results-branch',
      description: 'Results storage branch (default: agentv/results/v1)',
    }),
    resultsRemote: option({
      type: optional(string),
      long: 'results-remote',
      description: 'Advanced compatibility override: local Git remote name for results push/fetch',
    }),
    resultsPush: flag({
      long: 'results-push',
      description: 'Push the results branch after publishing the completed local run',
    }),
    noResultsPush: flag({
      long: 'no-results-push',
      description: 'Publish to the local results branch without pushing to the remote',
    }),
    resultsRequirePush: flag({
      long: 'results-require-push',
      description: 'Fail the eval command if the completed results branch cannot be pushed',
    }),
    agentTimeout: option({
      type: optional(number),
      long: 'agent-timeout',
      description: 'Optional top-level evaluation timeout in seconds. Unset by default.',
    }),
    maxRetries: option({
      type: optional(number),
      long: 'max-retries',
      description: 'Retry count for timeout recoveries (default: 2)',
    }),
    cache: flag({
      long: 'cache',
      description: 'Enable provider response cache (persisted to disk)',
    }),
    cachePath: option({
      type: optional(string),
      long: 'cache-path',
      description: 'Enable provider response cache at the given directory',
    }),
    noCache: flag({
      long: 'no-cache',
      description: 'Disable response caching (overrides --cache, --cache-path, config, and YAML)',
    }),
    verbose: flag({
      long: 'verbose',
      description: 'Enable verbose logging',
    }),
    workspacePath: option({
      type: optional(string),
      long: 'workspace-path',
      description: 'Static workspace directory path to reuse for this run',
    }),
    keepWorkspaces: flag({
      long: 'keep-workspaces',
      description:
        'Preserve per-test workspaces after eval (default: keep on failure, cleanup on success)',
    }),
    retryErrors: option({
      type: optional(string),
      long: 'retry-errors',
      description:
        'Path to a previous run workspace or run manifest — re-run only execution_error test cases',
    }),
    resume: flag({
      long: 'resume',
      description:
        'Resume an interrupted run: skip already-completed tests and append new results to --output dir',
    }),
    rerunFailed: option({
      type: optional(string),
      long: 'rerun-failed',
      description:
        'Run ID, run workspace, or index.jsonl to rerun failed/errored tests while keeping passing results',
    }),
    strict: flag({
      long: 'strict',
      description: 'Exit with error on version mismatch (instead of warning)',
    }),
    artifacts: option({
      type: optional(string),
      long: 'artifacts',
      description: '[Removed: use --output <dir>] Former companion artifact directory',
    }),
    graderProvider: option({
      type: optional(string),
      long: 'grader-provider',
      description:
        'Override grader provider for all evaluators (e.g., "agentv", or a provider label from providers.yaml)',
    }),
    graderTarget: option({
      type: optional(string),
      long: 'grader-target',
      description: '[Removed: use --grader-provider <label>] Former grader target selector',
    }),
    model: option({
      type: optional(string),
      long: 'model',
      description: 'Override model for the grader target (e.g., "openai:gpt-5-mini")',
    }),
    outputMessages: option({
      type: optional(string),
      long: 'output-messages',
      description:
        'Number of trailing messages to include in results output (default: 1, or "all")',
    }),
    threshold: option({
      type: optional(number),
      long: 'threshold',
      description:
        'Per-test score threshold (0-1, default 0.8). Exit 1 if any test scores below this value',
    }),
    budgetUsd: option({
      type: optional(number),
      long: 'budget-usd',
      description:
        'Maximum total cost in USD across all eval files in this run. Stops dispatching new cases when exceeded.',
    }),
    tag: multioption({
      type: array(string),
      long: 'tag',
      description:
        'Repeatable. `--tag name` filters to eval files with that tag (AND logic). `--tag key=value` sets a promptfoo-shaped run tag; `--tag experiment=<name>` labels the experiment (CLI > project config > eval tags).',
    }),
    excludeTag: multioption({
      type: array(string),
      long: 'exclude-tag',
      description: 'Skip eval files that have this tag (repeatable, file skipped if any match)',
    }),
    transcript: option({
      type: optional(string),
      long: 'transcript',
      description:
        'Grade a pre-recorded transcript JSONL instead of invoking a live provider. Ignores providers.',
    }),
    recordReplay: option({
      type: optional(string),
      long: 'record-replay',
      description:
        'Append live provider outputs to a replay fixture JSONL file. Graders still run normally.',
    }),
    recordReplayVariant: option({
      type: optional(string),
      long: 'record-replay-variant',
      description: 'Optional variant key to store with --record-replay fixture rows.',
    }),
  },
  handler: async (args) => {
    if (args.budgetUsd !== undefined && args.budgetUsd <= 0) {
      console.error('Error: --budget-usd must be a positive number.');
      process.exit(2);
    }
    if (args.resultsPush && args.noResultsPush) {
      console.error('Error: --results-push and --no-results-push cannot be used together.');
      process.exit(2);
    }
    const rawOptions = buildEvalRunRawOptions(args);
    const result = await runEvalCommand({ testFiles: args.evalPaths, rawOptions });
    if (result?.allExecutionErrors) {
      process.exit(2);
    }
    if (result?.budgetExceeded) {
      process.exit(1);
    }
    if (result?.thresholdFailed) {
      process.exit(1);
    }
  },
});

export function buildEvalRunRawOptions(args: {
  readonly [key: string]: unknown;
  readonly target?: readonly string[];
  readonly targets?: string;
  readonly provider?: readonly string[];
  readonly providers?: string;
  readonly graderTarget?: string;
  readonly graderProvider?: string;
}): Record<string, unknown> {
  const legacyTargets = Array.isArray(args.target)
    ? args.target.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (legacyTargets.length > 0) {
    throw new Error(
      `--target was removed from agentv eval. Use --provider ${legacyTargets[0]} instead.`,
    );
  }
  if (args.targets !== undefined) {
    throw new Error(
      `--targets was removed from agentv eval. Use --providers ${String(args.targets)} instead.`,
    );
  }
  if (args.graderTarget !== undefined) {
    throw new Error(
      `--grader-target was removed from agentv eval. Use --grader-provider ${args.graderTarget} instead.`,
    );
  }

  return {
    provider: args.provider,
    providers: args.providers,
    filter: args.testId,
    workers: args.workers,
    out: args.out,
    output: args.output,
    outputFormat: args.outputFormat,
    experiment: args.experiment,
    resultsRepo: args.resultsRepo,
    resultsBranch: args.resultsBranch,
    resultsRemote: args.resultsRemote,
    resultsPush: args.resultsPush,
    noResultsPush: args.noResultsPush,
    resultsRequirePush: args.resultsRequirePush,
    agentTimeout: args.agentTimeout,
    maxRetries: args.maxRetries,
    cache: args.cache,
    cachePath: args.cachePath,
    noCache: args.noCache,
    verbose: args.verbose,
    workspacePath: args.workspacePath,
    keepWorkspaces: args.keepWorkspaces,
    trace: false,
    retryErrors: args.retryErrors,
    resume: args.resume,
    rerunFailed: args.rerunFailed,
    strict: args.strict,
    artifacts: args.artifacts,
    graderTarget: args.graderProvider,
    model: args.model,
    outputMessages: args.outputMessages,
    threshold: args.threshold,
    budgetUsd: args.budgetUsd,
    tag: args.tag,
    excludeTag: args.excludeTag,
    transcript: args.transcript,
    recordReplay: args.recordReplay,
    recordReplayVariant: args.recordReplayVariant,
  };
}
