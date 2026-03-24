/**
 * `agentv pipeline bench` — Merge code-grader and LLM grader scores into final
 * benchmark artifacts.
 *
 * Reads code_grader_results from disk and LLM grader scores from stdin,
 * computes weighted pass_rate per test, and writes:
 *   - <test-id>/grading.json  (per-test grading breakdown)
 *   - index.jsonl             (one line per test)
 *   - benchmark.json          (aggregate statistics)
 *
 * Stdin format (LLM scores):
 *   { "<test-id>": { "<grader-name>": { "score": 0.85, "assertions": [...] } } }
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { command, positional, string } from 'cmd-ts';

interface EvaluatorScore {
  readonly name: string;
  readonly type: string;
  readonly score: number;
  readonly weight: number;
  readonly assertions: readonly { text: string; passed: boolean; evidence?: string }[];
}

export const evalBenchCommand = command({
  name: 'bench',
  description: 'Merge evaluator scores and produce benchmark artifacts',
  args: {
    exportDir: positional({
      type: string,
      displayName: 'export-dir',
      description: 'Export directory from pipeline input/grade',
    }),
  },
  handler: async ({ exportDir }) => {
    const manifest = JSON.parse(await readFile(join(exportDir, 'manifest.json'), 'utf8'));
    const testIds: string[] = manifest.test_ids;
    const targetName: string = manifest.target?.name ?? 'unknown';

    // Read LLM scores from stdin
    const stdinData = await readStdin();
    const llmScores: Record<
      string,
      Record<
        string,
        { score: number; assertions: { text: string; passed: boolean; evidence?: string }[] }
      >
    > = stdinData ? JSON.parse(stdinData) : {};

    const indexLines: string[] = [];
    const allPassRates: number[] = [];

    for (const testId of testIds) {
      const testDir = join(exportDir, testId);
      const evaluators: EvaluatorScore[] = [];
      const allAssertions: { text: string; passed: boolean; evidence: string }[] = [];

      // Collect code grader results
      const codeResultsDir = join(testDir, 'code_grader_results');
      try {
        const resultFiles = (await readdir(codeResultsDir)).filter((f) => f.endsWith('.json'));
        for (const file of resultFiles) {
          const result = JSON.parse(await readFile(join(codeResultsDir, file), 'utf8'));
          evaluators.push({
            name: result.name,
            type: 'code-grader',
            score: result.score,
            weight: result.weight ?? 1.0,
            assertions: result.assertions ?? [],
          });
          for (const a of result.assertions ?? []) {
            allAssertions.push({ text: a.text, passed: a.passed, evidence: a.evidence ?? '' });
          }
        }
      } catch {
        // No code grader results
      }

      // Collect LLM grader scores (from stdin data)
      const testLlmScores = llmScores[testId] ?? {};
      // Read LLM grader metadata for weights
      const llmGradersDir = join(testDir, 'llm_graders');
      try {
        const graderFiles = (await readdir(llmGradersDir)).filter((f) => f.endsWith('.json'));
        for (const file of graderFiles) {
          const graderMeta = JSON.parse(await readFile(join(llmGradersDir, file), 'utf8'));
          const graderName = graderMeta.name;
          const llmResult = testLlmScores[graderName];

          if (llmResult) {
            evaluators.push({
              name: graderName,
              type: 'llm-grader',
              score: llmResult.score,
              weight: graderMeta.weight ?? 1.0,
              assertions: llmResult.assertions ?? [],
            });
            for (const a of llmResult.assertions ?? []) {
              allAssertions.push({ text: a.text, passed: a.passed, evidence: a.evidence ?? '' });
            }
          }
        }
      } catch {
        // No LLM graders
      }

      // Compute weighted score
      const totalWeight = evaluators.reduce((sum, e) => sum + e.weight, 0);
      const weightedScore =
        totalWeight > 0
          ? evaluators.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight
          : 0;

      const passed = allAssertions.filter((a) => a.passed).length;
      const failed = allAssertions.filter((a) => !a.passed).length;
      const passRate =
        allAssertions.length > 0 ? Math.round((passed / allAssertions.length) * 1000) / 1000 : 0;

      allPassRates.push(passRate);

      // Write grading.json
      const grading = {
        assertions: allAssertions,
        summary: { passed, failed, total: allAssertions.length, pass_rate: passRate },
        execution_metrics: { tool_calls: {}, total_tool_calls: 0, errors_encountered: 0 },
        evaluators: evaluators.map((e) => ({
          name: e.name,
          type: e.type,
          score: e.score,
          reasoning: '',
          weight: e.weight,
        })),
      };
      await writeFile(
        join(testDir, 'grading.json'),
        `${JSON.stringify(grading, null, 2)}\n`,
        'utf8',
      );

      // Build index entry
      indexLines.push(
        JSON.stringify({
          timestamp: manifest.timestamp,
          test_id: testId,
          score: Math.round(weightedScore * 1000) / 1000,
          target: targetName,
          grading_path: `${testId}/grading.json`,
          timing_path: `${testId}/timing.json`,
        }),
      );
    }

    // Write index.jsonl
    await writeFile(
      join(exportDir, 'index.jsonl'),
      indexLines.length > 0 ? `${indexLines.join('\n')}\n` : '',
      'utf8',
    );

    // Write benchmark.json
    const passRateStats = computeStats(allPassRates);
    const benchmark = {
      metadata: {
        eval_file: manifest.eval_file,
        timestamp: manifest.timestamp,
        targets: [targetName],
        tests_run: testIds,
      },
      run_summary: {
        [targetName]: {
          pass_rate: passRateStats,
          time_seconds: { mean: 0, stddev: 0 },
          tokens: { mean: 0, stddev: 0 },
        },
      },
      notes: [],
    };
    await writeFile(
      join(exportDir, 'benchmark.json'),
      `${JSON.stringify(benchmark, null, 2)}\n`,
      'utf8',
    );

    console.log(`Benchmark: ${testIds.length} test(s), pass_rate=${passRateStats.mean}`);
  },
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function computeStats(values: readonly number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    mean: Math.round(mean * 1000) / 1000,
    stddev: Math.round(Math.sqrt(variance) * 1000) / 1000,
  };
}
