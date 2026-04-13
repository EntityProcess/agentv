/**
 * `agentv pipeline grade` — Run code-grader and built-in deterministic assertions
 * against response.md files in an export directory produced by `pipeline input`.
 *
 * For each test:
 * - Reads code_graders/<name>.json configs, executes each grader script,
 *   and writes results to code_grader_results/<name>.json.
 * - Reads builtin_graders/<name>.json configs, evaluates deterministic assertions
 *   (contains, regex, equals, etc.) in-process, and writes results to
 *   code_grader_results/<name>.json (same directory, so pipeline bench merges them).
 *
 * Code graders run concurrently (default: 10 workers) for performance.
 * Built-in graders are synchronous and evaluate instantly after code graders finish.
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
 * Run code-grader tasks with concurrency and progress feedback.
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
    const { testId, testDir, resultsDir, graderFile, responseText, inputData } = task;
    const graderConfig = JSON.parse(
      await readFile(join(testDir, 'code_graders', graderFile), 'utf8'),
    );
    const graderName = graderConfig.name;

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
        graderConfig.command,
        payload,
        undefined,
        graderConfig.cwd,
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

      const result = {
        name: graderName,
        type: 'code-grader',
        score,
        weight: graderConfig.weight ?? 1.0,
        assertions,
        details: parsed.details ?? {},
      };

      await writeFile(
        join(resultsDir, `${graderName}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );

      totalGraders++;
      if (score >= 0.5) totalPassed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n  ${testId}/${graderName}: ERROR — ${message}\n`);

      const errorResult = {
        name: graderName,
        type: 'code-grader',
        score: 0,
        weight: graderConfig.weight ?? 1.0,
        assertions: [{ text: `Error: ${message}`, passed: false }],
        details: { error: message },
      };

      await writeFile(
        join(resultsDir, `${graderName}.json`),
        `${JSON.stringify(errorResult, null, 2)}\n`,
        'utf8',
      );
      totalGraders++;
    } finally {
      completed++;
      writeProgress();
    }
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

/**
 * Run built-in deterministic assertions for all tests in the export directory.
 * Reads configs from builtin_graders/<name>.json, evaluates in-process,
 * and writes results to code_grader_results/<name>.json.
 */
async function runBuiltinGraders(
  exportDir: string,
  testIds: string[],
  safeSuiteName: string,
): Promise<{ total: number; passed: number }> {
  let total = 0;
  let passed = 0;

  for (const testId of testIds) {
    const subpath = safeSuiteName ? [safeSuiteName, testId] : [testId];
    const testDir = join(exportDir, ...subpath);
    const builtinGradersDir = join(testDir, 'builtin_graders');

    let graderFiles: string[];
    try {
      graderFiles = (await readdir(builtinGradersDir)).filter((f) => f.endsWith('.json'));
    } catch {
      continue; // No builtin graders for this test
    }

    if (graderFiles.length === 0) continue;

    const resultsDir = join(testDir, 'code_grader_results');
    await mkdir(resultsDir, { recursive: true });

    let responseText: string;
    try {
      responseText = await readFile(join(testDir, 'response.md'), 'utf8');
    } catch {
      continue; // No response yet — skip
    }

    for (const file of graderFiles) {
      const config = JSON.parse(await readFile(join(builtinGradersDir, file), 'utf8'));
      const raw = evaluateBuiltinAssertion(config, responseText);

      // Apply negate if configured
      const negate = config.negate === true;
      const score = negate ? 1 - raw.score : raw.score;
      const assertions = negate
        ? raw.assertions.map((a: { text: string; passed: boolean }) => ({
            text: a.text,
            passed: !a.passed,
          }))
        : raw.assertions;

      const result = {
        name: config.name,
        type: config.type,
        score,
        weight: config.weight ?? 1.0,
        assertions,
        details: {},
      };

      await writeFile(
        join(resultsDir, `${config.name}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );

      total++;
      if (score >= 0.5) passed++;
    }
  }

  return { total, passed };
}

export const evalGradeCommand = command({
  name: 'grade',
  description: 'Run code-grader and built-in assertions on responses in an export directory',
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

    // Collect all code-grader tasks upfront so we know the total count
    const tasks: GraderTask[] = [];

    for (const testId of testIds) {
      const subpath = safeSuiteName ? [safeSuiteName, testId] : [testId];
      const testDir = join(exportDir, ...subpath);
      const codeGradersDir = join(testDir, 'code_graders');
      const resultsDir = join(testDir, 'code_grader_results');

      let graderFiles: string[];
      try {
        graderFiles = (await readdir(codeGradersDir)).filter((f) => f.endsWith('.json'));
      } catch {
        graderFiles = [];
      }

      if (graderFiles.length > 0) {
        await mkdir(resultsDir, { recursive: true });
        const responseText = await readFile(join(testDir, 'response.md'), 'utf8');
        const inputData = JSON.parse(await readFile(join(testDir, 'input.json'), 'utf8'));

        for (const graderFile of graderFiles) {
          tasks.push({ testId, testDir, resultsDir, graderFile, responseText, inputData });
        }
      }
    }

    const { totalGraders, totalPassed } = await runCodeGraders(tasks, maxWorkers);

    // Run built-in deterministic assertions (contains, regex, equals, etc.)
    const builtin = await runBuiltinGraders(exportDir, testIds, safeSuiteName);

    const totalAll = totalGraders + builtin.total;
    const passedAll = totalPassed + builtin.passed;
    const parts: string[] = [];
    if (totalGraders > 0) parts.push(`${totalGraders} code-grader(s)`);
    if (builtin.total > 0) parts.push(`${builtin.total} built-in assertion(s)`);
    if (parts.length === 0) parts.push('0 grader(s)');
    console.log(`Graded ${parts.join(' + ')}: ${passedAll}/${totalAll} passed`);
  },
});
