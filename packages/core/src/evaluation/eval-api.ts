/**
 * Declarative Eval() API for single-file TypeScript evaluations.
 *
 * Eval() registers an eval in a global registry and returns a Promise
 * with results. Serves both CLI discovery (module-level, no await) and
 * programmatic use (await for results).
 *
 * @example Single-file eval with built-in target
 * ```typescript
 * import { Eval, Contains } from '@agentv/core';
 *
 * Eval('my-eval', {
 *   data: [{ input: 'What is 2+2?', expectedOutput: '4' }],
 *   target: { provider: 'claude_agent' },
 *   assert: [Contains('4')],
 * });
 * ```
 *
 * @module
 */

import path from 'node:path';
import type { AssertContext, AssertFn, AssertResult } from './assertions.js';
import type { EvalAssertionInput, EvalRunResult, EvalSummary } from './evaluate.js';
import type { ResolvedTarget } from './providers/targets.js';
import type { Provider, TargetDefinition } from './providers/types.js';
import type { EvalTest, EvaluationResult, EvaluatorConfig } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────

/** Data item — aligns with YAML test fields (camelCase) */
export interface EvalDataItem {
  readonly id?: string;
  readonly input: string | readonly { role: string; content: string }[];
  readonly expectedOutput?: string;
  readonly criteria?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Assert entry: inline function, built-in factory result, or assertion config */
export type AssertEntry = AssertFn | EvalAssertionInput;

/** Configuration for Eval() */
export interface EvalOptions {
  readonly data:
    | readonly EvalDataItem[]
    | (() => readonly EvalDataItem[] | Promise<readonly EvalDataItem[]>);
  readonly target?: TargetDefinition;
  readonly task?: (input: string) => string | Promise<string>;
  readonly assert: readonly AssertEntry[];
  readonly metadata?: Record<string, unknown>;
  readonly workers?: number;
  readonly agentTimeoutMs?: number;
}

// ─── Registry ────────────────────────────────────────────────────────

interface RegisteredEval {
  readonly name: string;
  readonly options: EvalOptions;
  readonly promise: Promise<EvalRunResult>;
}

const evalRegistry = new Map<string, RegisteredEval>();

/** Get all registered evals (used by CLI to discover evals in .ts files). */
export function getRegisteredEvals(): ReadonlyMap<string, RegisteredEval> {
  return evalRegistry;
}

/** Clear the registry (used in tests). */
export function clearEvalRegistry(): void {
  evalRegistry.clear();
}

// ─── Eval() ──────────────────────────────────────────────────────────

/**
 * Declare and run an evaluation.
 *
 * Registers the eval in a global registry (for CLI discovery) and
 * returns a Promise with results (for programmatic use).
 */
export function Eval(name: string, options: EvalOptions): Promise<EvalRunResult> {
  // Validate
  if (evalRegistry.has(name)) {
    throw new Error(`Eval "${name}" already registered`);
  }
  if (options.task && options.target) {
    throw new Error('Cannot specify both "task" and "target" — use one or the other.');
  }
  if (!options.task && !options.target) {
    throw new Error('Must specify either "task" or "target".');
  }

  // Create the execution promise
  const promise = runEval(name, options);

  evalRegistry.set(name, { name, options, promise });
  return promise;
}

// ─── Inline function storage via symbol ──────────────────────────────

/**
 * Symbol used to attach inline AssertFn references to EvaluatorConfig objects.
 * This avoids global state and race conditions between concurrent Eval() calls.
 */
export const INLINE_ASSERT_FN = Symbol.for('agentv.inline-assert-fn');

// ─── Internal execution ──────────────────────────────────────────────

async function runEval(name: string, options: EvalOptions): Promise<EvalRunResult> {
  // Lazy imports to avoid circular dependencies and keep module lightweight
  const { runEvaluation } = await import('./orchestrator.js');
  const { resolveTargetDefinition } = await import('./providers/targets.js');
  const { findGitRoot } = await import('./file-utils.js');
  const { createFunctionProvider } = await import('./providers/function-provider.js');

  // Resolve data
  const data = typeof options.data === 'function' ? await options.data() : options.data;

  // Partition assert entries into inline functions and config objects
  const evaluatorConfigs: EvaluatorConfig[] = [];

  for (let i = 0; i < options.assert.length; i++) {
    const entry = options.assert[i];
    if (typeof entry === 'function') {
      // Inline function: create an evaluator config with the function attached via symbol
      const config = {
        type: 'inline-assert',
        name: `inline-assert-${i}`,
        [INLINE_ASSERT_FN]: entry as AssertFn,
      } as unknown as EvaluatorConfig;
      evaluatorConfigs.push(config);
    } else {
      // Config object: normalize type and pass through
      const a = entry as EvalAssertionInput;
      const { type: rawType, ...rest } = a;
      evaluatorConfigs.push({
        ...rest,
        name: a.name ?? `${rawType}_${i}`,
        type: rawType.replace(/_/g, '-'),
      } as unknown as EvaluatorConfig);
    }
  }

  // Resolve target
  const targetDef: TargetDefinition = options.target ?? { name: 'custom-task', provider: 'mock' };
  const resolvedTarget = resolveTargetDefinition(targetDef);

  // Build providerFactory for task functions
  let providerFactory: ((target: ResolvedTarget) => Provider) | undefined;
  if (options.task) {
    const taskProvider = createFunctionProvider(options.task);
    providerFactory = () => taskProvider;
  }

  // Convert data items to EvalTest[]
  const evalCases: EvalTest[] = data.map((item, i) => {
    const input =
      typeof item.input === 'string'
        ? ([{ role: 'user' as const, content: item.input }] as EvalTest['input'])
        : (item.input as unknown as EvalTest['input']);

    const question =
      typeof item.input === 'string'
        ? item.input
        : ((item.input.find((m) => m.role === 'user')?.content as string) ?? '');

    const expectedOutput = item.expectedOutput
      ? ([
          { role: 'assistant' as const, content: item.expectedOutput },
        ] as EvalTest['expected_output'])
      : [];

    // Build input_segments so buildPromptInputs can extract the question
    const inputSegments =
      typeof item.input === 'string'
        ? [{ type: 'text' as const, value: item.input }]
        : (item.input as readonly { role: string; content: string }[])
            .filter((m) => m.role === 'user' && typeof m.content === 'string')
            .map((m) => ({ type: 'text' as const, value: m.content }));

    return {
      id: item.id ? `${name}/${item.id}` : `${name}/${i}`,
      criteria: item.criteria ?? '',
      question: String(question),
      input,
      input_segments: inputSegments,
      expected_output: expectedOutput,
      reference_answer: item.expectedOutput,
      guideline_paths: [],
      guideline_patterns: [],
      file_paths: [],
      evaluators: evaluatorConfigs.length > 0 ? evaluatorConfigs : undefined,
      metadata: item.metadata,
    };
  });

  const startTime = Date.now();
  const repoRoot = (await findGitRoot(process.cwd())) ?? process.cwd();
  const testFilePath = path.join(process.cwd(), '__eval_api__.yaml');

  const collectedResults: EvaluationResult[] = [];

  await runEvaluation({
    testFilePath,
    repoRoot,
    target: resolvedTarget,
    maxRetries: 2,
    agentTimeoutMs: options.agentTimeoutMs,
    maxConcurrency: options.workers ?? 3,
    evalCases,
    ...(providerFactory ? { providerFactory } : {}),
    onResult: async (result) => {
      collectedResults.push(result);
    },
  });

  const durationMs = Date.now() - startTime;
  return {
    results: collectedResults,
    summary: computeSummary(collectedResults, durationMs),
  };
}

// ─── Summary computation ─────────────────────────────────────────────

function computeSummary(results: readonly EvaluationResult[], durationMs: number): EvalSummary {
  const total = results.length;
  let passed = 0;
  let failed = 0;
  let borderline = 0;
  let scoreSum = 0;

  for (const r of results) {
    scoreSum += r.score;
    if (r.score >= 0.8) {
      passed++;
    } else if (r.score < 0.5) {
      failed++;
    } else {
      borderline++;
    }
  }

  return {
    total,
    passed,
    failed,
    borderline,
    durationMs,
    meanScore: total > 0 ? scoreSum / total : 0,
  };
}

// ─── Legacy inline assert function storage (for backward compat) ─────

let _inlineAssertFns: AssertFn[] = [];

export function setInlineAssertFns(fns: AssertFn[]): void {
  _inlineAssertFns = fns;
}

export function getInlineAssertFns(): AssertFn[] {
  return _inlineAssertFns;
}

// Re-export types
export type { AssertContext, AssertResult, AssertFn } from './assertions.js';
export type { EvalRunResult, EvalSummary } from './evaluate.js';
