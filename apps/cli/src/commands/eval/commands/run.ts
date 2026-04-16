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
import { resolveEvalPaths } from '../shared.js';

export const evalRunCommand = command({
  name: 'eval',
  description: 'Run eval suites and report results',
  args: {
    evalPaths: restPositionals({
      type: string,
      displayName: 'eval-paths',
      description: 'Path(s) or glob(s) to evaluation files (.yaml, .eval.ts)',
    }),
    target: multioption({
      type: array(string),
      long: 'target',
      description: 'Override target name(s) from targets.yaml (repeatable for matrix evaluation)',
    }),
    targets: option({
      type: optional(string),
      long: 'targets',
      description: 'Path to targets.yaml (overrides discovery)',
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
        'Number of parallel test cases within each eval file (default: 3, max: 50). Eval files always run sequentially. Can also be set per-target in targets.yaml',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      description: '[Deprecated: use --output] Write results to the specified path',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description:
        'Artifact directory for run output (index.jsonl, benchmark.json, per-test grading/timing)',
    }),
    outputFormat: option({
      type: optional(string),
      long: 'output-format',
      description: "[Deprecated] Output format: 'jsonl', 'yaml', or 'html' (default: jsonl)",
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Experiment label for canonical run output (default: default)',
    }),
    export: multioption({
      type: array(string),
      long: 'export',
      description:
        'Write additional output file(s). Format inferred from extension: .jsonl, .json, .xml, .yaml, .html (repeatable)',
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
    noCache: flag({
      long: 'no-cache',
      description: 'Disable caching (overrides YAML execution.cache)',
    }),
    verbose: flag({
      long: 'verbose',
      description: 'Enable verbose logging',
    }),
    workspaceMode: option({
      type: optional(string),
      long: 'workspace-mode',
      description: "Workspace mode: 'pooled', 'temp', or 'static'",
    }),
    workspacePath: option({
      type: optional(string),
      long: 'workspace-path',
      description: 'Static workspace directory path (used when workspace mode is static)',
    }),
    keepWorkspaces: flag({
      long: 'keep-workspaces',
      description:
        'Preserve per-test workspaces after eval (default: keep on failure, cleanup on success)',
    }),
    otelFile: option({
      type: optional(string),
      long: 'otel-file',
      description: 'Write OTLP JSON trace to file (importable by OTel backends)',
    }),
    exportOtel: flag({
      long: 'export-otel',
      description: 'Export evaluation traces via OTLP/HTTP to configured endpoint',
    }),
    otelBackend: option({
      type: optional(string),
      long: 'otel-backend',
      description: 'Use a backend preset (langfuse, braintrust, confident)',
    }),
    otelCaptureContent: flag({
      long: 'otel-capture-content',
      description: 'Include message content in exported OTel spans (privacy: disabled by default)',
    }),
    otelGroupTurns: flag({
      long: 'otel-group-turns',
      description:
        'Group messages into turn spans for multi-turn evaluations (requires --export-otel)',
    }),
    retryErrors: option({
      type: optional(string),
      long: 'retry-errors',
      description:
        'Path to a previous run workspace or index.jsonl manifest — re-run only execution_error test cases',
    }),
    resume: flag({
      long: 'resume',
      description:
        'Resume an interrupted run: skip already-completed tests and append new results to --output dir',
    }),
    rerunFailed: flag({
      long: 'rerun-failed',
      description:
        'Rerun failed/errored tests while keeping passing results. Implies --resume semantics',
    }),
    strict: flag({
      long: 'strict',
      description: 'Exit with error on version mismatch (instead of warning)',
    }),
    benchmarkJson: option({
      type: optional(string),
      long: 'benchmark-json',
      description:
        '[Deprecated: benchmark.json is included in artifact dir] Write Agent Skills benchmark.json to the specified path',
    }),
    artifacts: option({
      type: optional(string),
      long: 'artifacts',
      description:
        '[Deprecated: use --output] Write companion artifacts to the specified directory',
    }),
    graderTarget: option({
      type: optional(string),
      long: 'grader-target',
      description:
        'Override grader target for all evaluators (e.g., "agentv", or a target name from targets.yaml)',
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
    tag: multioption({
      type: array(string),
      long: 'tag',
      description: 'Only run eval files that have this tag (repeatable, AND logic)',
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
        'Grade a pre-recorded transcript JSONL instead of invoking a live provider. Ignores targets.',
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
      filter: args.testId,
      workers: args.workers,
      out: args.out,
      output: args.output,
      outputFormat: args.outputFormat,
      experiment: args.experiment,
      export: args.export,
      dryRun: args.dryRun,
      dryRunDelay: args.dryRunDelay,
      dryRunDelayMin: args.dryRunDelayMin,
      dryRunDelayMax: args.dryRunDelayMax,
      agentTimeout: args.agentTimeout,
      maxRetries: args.maxRetries,
      cache: args.cache,
      noCache: args.noCache,
      verbose: args.verbose,
      workspaceMode: args.workspaceMode,
      workspacePath: args.workspacePath,
      keepWorkspaces: args.keepWorkspaces,
      trace: false,
      otelFile: args.otelFile,
      exportOtel: args.exportOtel,
      otelBackend: args.otelBackend,
      otelCaptureContent: args.otelCaptureContent,
      otelGroupTurns: args.otelGroupTurns,
      retryErrors: args.retryErrors,
      resume: args.resume,
      rerunFailed: args.rerunFailed,
      strict: args.strict,
      benchmarkJson: args.benchmarkJson,
      artifacts: args.artifacts,
      graderTarget: args.graderTarget,
      model: args.model,
      outputMessages: args.outputMessages,
      threshold: args.threshold,
      tag: args.tag,
      excludeTag: args.excludeTag,
      transcript: args.transcript,
    };
    const result = await runEvalCommand({ testFiles: resolvedPaths, rawOptions });
    if (result?.allExecutionErrors) {
      process.exit(2);
    }
    if (result?.thresholdFailed) {
      process.exit(1);
    }
  },
});
