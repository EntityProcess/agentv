/**
 * `agentv pipeline grade` — Run code-grader assertions against response.md files
 * in an export directory produced by `pipeline input`.
 *
 * For each test, reads code_graders/<name>.json configs, executes each grader
 * with the response text on stdin (matching CodeEvaluator payload format),
 * and writes results to code_grader_results/<name>.json.
 *
 * Graders run concurrently (default: 4 workers) for performance.
 * Progress is printed to stderr so users see real-time feedback.
 *
 * Export directory additions:
 *   <out-dir>/<dataset>/<test-id>/code_grader_results/<name>.json
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { executeScript } from '@agentv/core';
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

export const evalGradeCommand = command({
  name: 'grade',
  description: 'Run code-grader assertions on responses in an export directory',
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
    const datasetName: string = manifest.dataset ?? '';
    const safeDatasetName = datasetName ? datasetName.replace(/[\/\\:*?"<>|]/g, '_') : '';

    // Collect all grader tasks upfront so we know the total count
    const tasks: GraderTask[] = [];

    for (const testId of testIds) {
      const subpath = safeDatasetName ? [safeDatasetName, testId] : [testId];
      const testDir = join(exportDir, ...subpath);
      const codeGradersDir = join(testDir, 'code_graders');
      const resultsDir = join(testDir, 'code_grader_results');

      let graderFiles: string[];
      try {
        graderFiles = (await readdir(codeGradersDir)).filter((f) => f.endsWith('.json'));
      } catch {
        continue; // No code graders for this test
      }

      if (graderFiles.length === 0) continue;
      await mkdir(resultsDir, { recursive: true });

      // Read response and input once per test (shared by all graders for this test)
      const responseText = await readFile(join(testDir, 'response.md'), 'utf8');
      const inputData = JSON.parse(await readFile(join(testDir, 'input.json'), 'utf8'));

      for (const graderFile of graderFiles) {
        tasks.push({ testId, testDir, resultsDir, graderFile, responseText, inputData });
      }
    }

    const { totalGraders, totalPassed } = await runCodeGraders(tasks, maxWorkers);
    console.log(`Graded ${totalGraders} code-grader(s): ${totalPassed} passed`);
  },
});
