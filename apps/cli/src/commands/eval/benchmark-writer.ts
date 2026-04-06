import { writeFile } from 'node:fs/promises';

import { DEFAULT_THRESHOLD, type EvaluationResult } from '@agentv/core';

interface BenchmarkStats {
  readonly mean: number;
  readonly stddev: number;
}

interface BenchmarkRunSummary {
  readonly pass_rate: BenchmarkStats;
  readonly time_seconds: BenchmarkStats;
  readonly tokens: BenchmarkStats;
}

interface BenchmarkJson {
  readonly run_summary: {
    readonly with_skill: BenchmarkRunSummary;
  };
}

function computeStats(values: readonly number[]): BenchmarkStats {
  if (values.length === 0) {
    return { mean: 0, stddev: 0 };
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    mean: Math.round(mean * 1000) / 1000,
    stddev: Math.round(Math.sqrt(variance) * 1000) / 1000,
  };
}

/**
 * Compute per-test pass_rate from evaluator scores.
 *
 * For each test, pass_rate = count(evaluator.score >= 0.8) / total_evaluators.
 * If no per-evaluator scores exist, falls back to the top-level result score
 * with the same threshold (>= 0.8 → 1.0, else 0.0).
 */
function computePassRate(result: EvaluationResult): number {
  const scores = result.scores;
  if (scores && scores.length > 0) {
    const passed = scores.filter((s) => s.score >= DEFAULT_THRESHOLD).length;
    return passed / scores.length;
  }
  return result.score >= DEFAULT_THRESHOLD ? 1.0 : 0.0;
}

/**
 * Build an Agent Skills benchmark.json from AgentV evaluation results.
 */
export function buildBenchmarkJson(results: readonly EvaluationResult[]): BenchmarkJson {
  const passRates = results.map(computePassRate);
  const timings = results
    .filter((r) => r.durationMs != null)
    .map((r) => (r.durationMs as number) / 1000);
  const tokens = results
    .filter((r) => r.tokenUsage != null)
    .map((r) => {
      const usage = r.tokenUsage as { input?: number; output?: number };
      return (usage.input ?? 0) + (usage.output ?? 0);
    });

  return {
    run_summary: {
      with_skill: {
        pass_rate: computeStats(passRates),
        time_seconds: computeStats(timings),
        tokens: computeStats(tokens),
      },
    },
  };
}

/**
 * Write benchmark.json to disk.
 */
export async function writeBenchmarkJson(
  outputPath: string,
  results: readonly EvaluationResult[],
): Promise<void> {
  const benchmark = buildBenchmarkJson(results);
  await writeFile(outputPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');
}
