/**
 * `agentv eval grade` — Run code-grader assertions against response.md files
 * in an export directory produced by `eval input`.
 *
 * For each test, reads code_graders/<name>.json configs, executes each grader
 * with the response text on stdin (matching CodeEvaluator payload format),
 * and writes results to code_grader_results/<name>.json.
 *
 * Export directory additions:
 *   <out-dir>/<test-id>/code_grader_results/<name>.json
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { executeScript } from '@agentv/core';
import { command, positional, string } from 'cmd-ts';

export const evalGradeCommand = command({
  name: 'grade',
  description: 'Run code-grader assertions on responses in an export directory',
  args: {
    exportDir: positional({
      type: string,
      displayName: 'export-dir',
      description: 'Export directory from eval input',
    }),
  },
  handler: async ({ exportDir }) => {
    const manifestPath = join(exportDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const testIds: string[] = manifest.test_ids;

    let totalGraders = 0;
    let totalPassed = 0;

    for (const testId of testIds) {
      const testDir = join(exportDir, testId);
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

      // Read response and input for stdin payload
      const responseText = await readFile(join(testDir, 'response.md'), 'utf8');
      const inputData = JSON.parse(await readFile(join(testDir, 'input.json'), 'utf8'));

      for (const graderFile of graderFiles) {
        const graderConfig = JSON.parse(await readFile(join(codeGradersDir, graderFile), 'utf8'));
        const graderName = graderConfig.name;

        // Build stdin payload matching CodeEvaluator format (snake_case)
        const payload = JSON.stringify({
          output: [{ role: 'assistant', content: responseText }],
          input: inputData.input_messages,
          question: inputData.input_text,
          criteria: '',
          expected_output: [],
          reference_answer: '',
          input_files: [],
          trace: null,
          token_usage: null,
          cost_usd: null,
          duration_ms: null,
          start_time: null,
          end_time: null,
          file_changes: null,
          workspace_path: null,
          config: graderConfig.config ?? null,
          metadata: {},
          input_text: inputData.input_text,
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
          const assertions = Array.isArray(parsed.assertions) ? parsed.assertions : [];

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
          console.error(`  ${testId}/${graderName}: ERROR — ${message}`);

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
        }
      }
    }

    console.log(`Graded ${totalGraders} code-grader(s): ${totalPassed} passed`);
  },
});
