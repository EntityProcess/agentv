import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface ResolvedTargetLike {
  readonly name: string;
  readonly kind: string;
}

interface RunEvaluationOptionsLike {
  readonly testFilePath: string;
  readonly repoRoot: string | URL;
  readonly target: ResolvedTargetLike;
  readonly targets?: ReadonlyArray<unknown>;
  readonly agentTimeoutMs?: number;
  readonly promptDumpDir?: string;
  readonly cache?: unknown;
  readonly useCache?: boolean;
  readonly filter?: string | readonly string[];
  readonly evalCases?: ReadonlyArray<unknown>;
  readonly verbose?: boolean;
  readonly budgetUsd?: number;
  readonly runBudgetTracker?: {
    readonly budgetCapUsd?: number;
  };
  readonly onResult?: (result: EvaluationResultLike) => Promise<void> | void;
}

function getCachePath(cache: unknown): string | null {
  if (!cache || typeof cache !== 'object') {
    return null;
  }
  const maybeCachePath = (cache as { readonly cachePath?: unknown }).cachePath;
  return typeof maybeCachePath === 'string' ? maybeCachePath : null;
}

interface EvaluationResultLike {
  readonly testId: string;
  readonly score: number;
  readonly assertions: readonly {
    readonly text: string;
    readonly passed: boolean;
    readonly evidence?: string;
  }[];
  readonly output: readonly { readonly role: string; readonly content: string }[];
  readonly expectedAspectCount: number;
  readonly target: string;
  readonly timestamp: string;
}

function evalCaseIds(evalCases: ReadonlyArray<unknown> | undefined): readonly string[] {
  if (!Array.isArray(evalCases) || evalCases.length === 0) {
    return ['case-alpha', 'case-beta'];
  }
  return evalCases
    .map((evalCase) =>
      evalCase &&
      typeof evalCase === 'object' &&
      'id' in evalCase &&
      typeof evalCase.id === 'string'
        ? evalCase.id
        : undefined,
    )
    .filter((id): id is string => id !== undefined);
}

function buildResult(targetName: string, testId: string, index: number): EvaluationResultLike {
  const baseTime = new Date('2024-01-01T00:00:00.000Z');
  if (testId === 'case-alpha') {
    return {
      testId: 'case-alpha',
      score: 0.6,
      assertions: [{ text: 'alpha', passed: true }],
      output: [{ role: 'assistant', content: 'Alpha answer' }],
      expectedAspectCount: 1,
      target: targetName,
      timestamp: baseTime.toISOString(),
    };
  }
  if (testId === 'case-beta') {
    return {
      testId: 'case-beta',
      score: 0.9,
      assertions: [
        { text: 'beta', passed: true },
        { text: 'gamma', passed: true },
        { text: 'delta', passed: false },
      ],
      output: [{ role: 'assistant', content: 'Beta answer' }],
      expectedAspectCount: 3,
      target: targetName,
      timestamp: new Date(baseTime.getTime() + 60_000).toISOString(),
    };
  }
  return {
    testId,
    score: 1,
    assertions: [{ text: testId, passed: true }],
    output: [{ role: 'assistant', content: `${testId} answer` }],
    expectedAspectCount: 1,
    target: targetName,
    timestamp: new Date(baseTime.getTime() + index * 60_000).toISOString(),
  };
}

function buildResults(
  targetName: string,
  evalCases: ReadonlyArray<unknown> | undefined,
): EvaluationResultLike[] {
  return evalCaseIds(evalCases).map((testId, index) => buildResult(targetName, testId, index));
}

async function maybeWriteDiagnostics(
  options: RunEvaluationOptionsLike,
  results: readonly EvaluationResultLike[],
): Promise<void> {
  const diagnosticsPath = process.env.AGENTEVO_CLI_EVAL_RUNNER_OUTPUT;
  if (!diagnosticsPath) {
    return;
  }

  const payload = {
    target: options.target?.name,
    targetKind: options.target?.kind,
    agentTimeoutMs: options.agentTimeoutMs ?? null,
    promptDumpDir: options.promptDumpDir,
    filter: options.filter ?? null,
    hasCache: options.cache !== undefined,
    cachePath: getCachePath(options.cache),
    useCache: options.useCache ?? false,
    envSample: process.env.CLI_ENV_SAMPLE ?? null,
    envRootOnly: process.env.CLI_ENV_ROOT_ONLY ?? null,
    envLocalOnly: process.env.CLI_ENV_LOCAL_ONLY ?? null,
    budgetUsd: options.budgetUsd ?? null,
    hasRunBudgetTracker: options.runBudgetTracker !== undefined,
    runBudgetCapUsd: options.runBudgetTracker?.budgetCapUsd ?? null,
    evalCaseIds: Array.isArray(options.evalCases)
      ? options.evalCases
          .map((evalCase) =>
            evalCase &&
            typeof evalCase === 'object' &&
            'id' in evalCase &&
            typeof evalCase.id === 'string'
              ? evalCase.id
              : null,
          )
          .filter((id): id is string => id !== null)
      : null,
    resultCount: results.length,
  } satisfies Record<string, unknown>;

  await writeFile(diagnosticsPath, JSON.stringify(payload, null, 2), 'utf8');
}

async function maybeWritePromptDump(
  promptDumpDir: string | undefined,
  testIds: readonly string[],
): Promise<void> {
  if (!promptDumpDir) {
    return;
  }
  await mkdir(promptDumpDir, { recursive: true });
  const payload = { source: 'mock-run-evaluation' } satisfies Record<string, unknown>;
  for (const testId of testIds) {
    const filePath = path.join(promptDumpDir, `${testId}.json`);
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  }
}

export async function runEvaluation(
  options: RunEvaluationOptionsLike,
): Promise<readonly EvaluationResultLike[]> {
  const results = buildResults(options.target?.name ?? 'unknown-target', options.evalCases);

  await maybeWriteDiagnostics(options, results);
  await maybeWritePromptDump(
    options.promptDumpDir,
    results.map((result) => result.testId),
  );

  for (const result of results) {
    if (options.onResult) {
      await options.onResult(result);
    }
  }

  return results;
}
