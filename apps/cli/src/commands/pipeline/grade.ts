/**
 * `agentv pipeline grade` — Run grader assertions against response.md files
 * in an export directory produced by `pipeline input`.
 *
 * All grader configs live in code_graders/<name>.json. Each config has a `type`
 * field that determines how it's evaluated:
 * - `code-grader` (or configs with a `command` field): executed as external scripts
 * - Built-in types (contains, regex, equals, etc.): evaluated in-process
 *
 * Results are written to code_grader_results/<name>.json for pipeline bench.
 *
 * Export directory additions:
 *   <out-dir>/<suite>/<test-id>/code_grader_results/<name>.json
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type AssertionResult,
  executeScript,
  runContainsAllAssertion,
  runContainsAnyAssertion,
  runContainsAssertion,
  runEndsWithAssertion,
  runEqualsAssertion,
  runIcontainsAllAssertion,
  runIcontainsAnyAssertion,
  runIcontainsAssertion,
  runIsJsonAssertion,
  runRegexAssertion,
  runStartsWithAssertion,
} from '@agentv/core';
import { command, number, option, optional, positional, string } from 'cmd-ts';

const DEFAULT_CONCURRENCY = 10;

/**
 * Convert a Message[] array to plain text.
 * Single message: returns content directly (no role prefix).
 * Multiple messages: prefixes each with @role for clarity.
 */
function extractInputText(input: Array<{ role: string; content: string }>): string {
  if (!input || input.length === 0) return '';
  if (input.length === 1) return input[0].content;
  return input.map((m) => `@[${m.role}]:\n${m.content}`).join('\n\n');
}

/** Describes a single grader to execute. */
export interface GraderTask {
  testId: string;
  testDir: string;
  resultsDir: string;
  graderFile: string;
  responseText: string;
  inputData: {
    input: Array<{ role: string; content: string }>;
    input_files?: unknown[];
    metadata?: Record<string, unknown>;
  };
}

/**
 * Run grader tasks with concurrency and progress feedback.
 * Dispatches each task based on its config: code-graders are executed as
 * external scripts, built-in types (contains, regex, etc.) are evaluated in-process.
 * Shared by `pipeline grade` and `pipeline run`.
 */
export async function runCodeGraders(
  tasks: GraderTask[],
  concurrency: number,
): Promise<{ totalGraders: number; totalPassed: number }> {
  let totalGraders = 0;
  let totalPassed = 0;
  let completed = 0;
  const total = tasks.length;

  if (total === 0) return { totalGraders: 0, totalPassed: 0 };

  const writeProgress = () => {
    process.stderr.write(`\rGrading: ${completed}/${total} done`);
  };

  writeProgress();

  const executeGrader = async (task: GraderTask) => {
    const { testDir, resultsDir, graderFile, responseText } = task;
    const graderConfig = JSON.parse(
      await readFile(join(testDir, 'code_graders', graderFile), 'utf8'),
    );

    // Dispatch: configs with a `command` field are external scripts;
    // all others are built-in deterministic assertions evaluated in-process.
    if (graderConfig.command) {
      await executeCodeGrader(graderConfig, task);
    } else {
      await executeBuiltinGrader(graderConfig, responseText, resultsDir);
    }

    totalGraders++;
    if (graderConfig._lastScore >= 0.5) totalPassed++;
    completed++;
    writeProgress();
  };

  /** Run an external code-grader script. */
  const executeCodeGrader = async (graderConfig: Record<string, unknown>, task: GraderTask) => {
    const { testId, resultsDir, responseText, inputData } = task;
    const graderName = graderConfig.name as string;
    const inputText = extractInputText(inputData.input);
    const payload = JSON.stringify({
      output: [{ role: 'assistant', content: responseText }],
      input: inputData.input,
      criteria: '',
      expected_output: [],
      input_files: inputData.input_files ?? [],
      trace: null,
      token_usage: null,
      cost_usd: null,
      duration_ms: null,
      start_time: null,
      end_time: null,
      file_changes: null,
      workspace_path: null,
      config: graderConfig.config ?? null,
      metadata: inputData.metadata ?? {},
      input_text: inputText,
      output_text: responseText,
      expected_output_text: '',
    });

    try {
      const stdout = await executeScript(
        graderConfig.command as string | string[],
        payload,
        undefined,
        graderConfig.cwd as string | undefined,
      );
      const parsed = JSON.parse(stdout);
      const score = typeof parsed.score === 'number' ? parsed.score : 0;
      // TODO: Remove hits/misses fallback once all grader scripts emit assertions natively.
      // The hits/misses format is deprecated; graders should output { assertions: [...] } directly.
      const assertions: { text: string; passed: boolean }[] =
        Array.isArray(parsed.assertions) && parsed.assertions.length > 0
          ? parsed.assertions
          : [
              ...(parsed.hits ?? []).map((h: string) => ({ text: h, passed: true })),
              ...(parsed.misses ?? []).map((m: string) => ({ text: m, passed: false })),
            ];

      graderConfig._lastScore = score;

      await writeFile(
        join(resultsDir, `${graderName}.json`),
        `${JSON.stringify({ name: graderName, type: 'code-grader', score, weight: graderConfig.weight ?? 1.0, assertions, details: parsed.details ?? {} }, null, 2)}\n`,
        'utf8',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n  ${testId}/${graderName}: ERROR — ${message}\n`);
      graderConfig._lastScore = 0;

      await writeFile(
        join(resultsDir, `${graderName}.json`),
        `${JSON.stringify({ name: graderName, type: 'code-grader', score: 0, weight: graderConfig.weight ?? 1.0, assertions: [{ text: `Error: ${message}`, passed: false }], details: { error: message } }, null, 2)}\n`,
        'utf8',
      );
    }
  };

  /** Evaluate a built-in deterministic assertion in-process. */
  const executeBuiltinGrader = async (
    graderConfig: Record<string, unknown>,
    responseText: string,
    resultsDir: string,
  ) => {
    const raw = evaluateBuiltinAssertion(
      graderConfig as { type: string; value?: unknown; flags?: string },
      responseText,
    );

    const negate = graderConfig.negate === true;
    const score = negate ? 1 - raw.score : raw.score;
    const assertions = negate
      ? raw.assertions.map((a: { text: string; passed: boolean }) => ({
          text: a.text,
          passed: !a.passed,
        }))
      : raw.assertions;

    graderConfig._lastScore = score;

    await writeFile(
      join(resultsDir, `${graderConfig.name}.json`),
      `${JSON.stringify({ name: graderConfig.name, type: graderConfig.type, score, weight: (graderConfig.weight as number) ?? 1.0, assertions, details: {} }, null, 2)}\n`,
      'utf8',
    );
  };

  // Run with concurrency limit
  const pending = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = executeGrader(task).then(() => {
      pending.delete(p);
    });
    pending.add(p);
    if (pending.size >= concurrency) {
      await Promise.race(pending);
    }
  }
  await Promise.all(pending);

  // Clear the progress line and print final summary
  process.stderr.write('\n');

  return { totalGraders, totalPassed };
}

/**
 * Evaluate a single built-in deterministic assertion against the response text.
 *
 * Dispatches to the appropriate assertion function based on the config type.
 * Returns the assertion result with score and descriptive assertions array.
 *
 * To add a new built-in assertion type:
 * 1. Import the runner from @agentv/core
 * 2. Add a case to the switch below
 * 3. Add the type to BUILTIN_ASSERTION_TYPES in pipeline/input.ts
 */
function evaluateBuiltinAssertion(
  config: { type: string; value?: unknown; flags?: string },
  responseText: string,
): AssertionResult {
  const value = config.value;
  switch (config.type) {
    case 'contains':
      return runContainsAssertion(responseText, value as string);
    case 'contains-any':
      return runContainsAnyAssertion(responseText, value as string[]);
    case 'contains-all':
      return runContainsAllAssertion(responseText, value as string[]);
    case 'icontains':
      return runIcontainsAssertion(responseText, value as string);
    case 'icontains-any':
      return runIcontainsAnyAssertion(responseText, value as string[]);
    case 'icontains-all':
      return runIcontainsAllAssertion(responseText, value as string[]);
    case 'starts-with':
      return runStartsWithAssertion(responseText, value as string);
    case 'ends-with':
      return runEndsWithAssertion(responseText, value as string);
    case 'regex':
      return runRegexAssertion(responseText, value as string, config.flags);
    case 'is-json':
      return runIsJsonAssertion(responseText);
    case 'equals':
      return runEqualsAssertion(responseText, value as string);
    default:
      return {
        score: 0,
        assertions: [{ text: `Unknown assertion type: ${config.type}`, passed: false }],
      };
  }
}

export const evalGradeCommand = command({
  name: 'grade',
  description: 'Run grader assertions on responses in an export directory',
  args: {
    exportDir: positional({
      type: string,
      displayName: 'export-dir',
      description: 'Export directory from pipeline input',
    }),
    concurrency: option({
      type: optional(number),
      long: 'concurrency',
      short: 'j',
      description: `Number of graders to run in parallel (default: ${DEFAULT_CONCURRENCY})`,
    }),
  },
  handler: async ({ exportDir, concurrency }) => {
    const maxWorkers = concurrency ?? DEFAULT_CONCURRENCY;
    const manifestPath = join(exportDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const testIds: string[] = manifest.test_ids;
    const suiteName: string = manifest.suite ?? '';
    const safeSuiteName = suiteName ? suiteName.replace(/[\/\\:*?"<>|]/g, '_') : '';

    // Collect all grader tasks upfront so we know the total count
    const tasks: GraderTask[] = [];

    for (const testId of testIds) {
      const subpath = safeSuiteName ? [safeSuiteName, testId] : [testId];
      const testDir = join(exportDir, ...subpath);
      const codeGradersDir = join(testDir, 'code_graders');
      const resultsDir = join(testDir, 'code_grader_results');

      let graderFiles: string[];
      try {
        graderFiles = (await readdir(codeGradersDir)).filter((f: string) => f.endsWith('.json'));
      } catch {
        continue; // No graders for this test
      }

      if (graderFiles.length === 0) continue;
      await mkdir(resultsDir, { recursive: true });

      const responseText = await readFile(join(testDir, 'response.md'), 'utf8');
      const inputData = JSON.parse(await readFile(join(testDir, 'input.json'), 'utf8'));

      for (const graderFile of graderFiles) {
        tasks.push({ testId, testDir, resultsDir, graderFile, responseText, inputData });
      }
    }

    const { totalGraders, totalPassed } = await runCodeGraders(tasks, maxWorkers);
    console.log(`Graded ${totalGraders} grader(s): ${totalPassed} passed`);
  },
});
