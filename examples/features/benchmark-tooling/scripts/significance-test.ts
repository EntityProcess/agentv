#!/usr/bin/env bun
/**
 * significance-test — Paired bootstrap significance test for result-file comparisons.
 *
 * Reads two result JSONL files (baseline and candidate), aligns records by
 * test_id, and runs a paired bootstrap resampling test on score differences.
 *
 * Usage:
 *   bun significance-test.ts <baseline.jsonl> <candidate.jsonl> [options]
 *
 * Options:
 *   --metric <name>        Label for the metric being tested (default: "score")
 *   --iterations <n>       Number of bootstrap iterations (default: 10000)
 *   --alpha <n>            Significance level (default: 0.05)
 *   --json                 Output machine-readable JSON only
 *   --seed <n>             RNG seed for reproducibility
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResultRecord {
  test_id?: string;
  eval_id?: string;
  score: number;
}

interface PairedObservation {
  test_id: string;
  baseline_score: number;
  candidate_score: number;
  difference: number;
}

interface SignificanceResult {
  method: string;
  metric: string;
  n_paired: number;
  n_unpaired_baseline: number;
  n_unpaired_candidate: number;
  unpaired_ids: { baseline_only: string[]; candidate_only: string[] };
  observed_mean_diff: number;
  effect_size_cohens_d: number | null;
  bootstrap: {
    iterations: number;
    ci_lower: number;
    ci_upper: number;
    ci_level: number;
    p_value: number;
  };
  alpha: number;
  significant: boolean;
  verdict: string;
  seed: number | null;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (xoshiro128** — fast, good quality, reproducible)
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let s0 = seed | 0;
  let s1 = (seed * 1597334677) | 0;
  let s2 = (seed * 2654435769) | 0;
  let s3 = (seed * 1013904223) | 0;
  // warm up
  for (let i = 0; i < 20; i++) {
    const t = (s1 << 9) | 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
  }
  return () => {
    const result = Math.imul(s1 * 5, 7) >>> 0;
    const t = (s1 << 9) | 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return result / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function readResultFile(filePath: string): Map<string, number> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const records = new Map<string, number>();

  for (const line of lines) {
    let record: ResultRecord;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // skip non-JSON lines
    }
    const id = record.test_id ?? record.eval_id;
    if (id == null || typeof record.score !== 'number') continue;
    records.set(id, record.score);
  }

  return records;
}

function alignPairs(
  baseline: Map<string, number>,
  candidate: Map<string, number>,
): {
  pairs: PairedObservation[];
  baselineOnly: string[];
  candidateOnly: string[];
} {
  const pairs: PairedObservation[] = [];
  const baselineOnly: string[] = [];

  for (const [id, baselineScore] of baseline) {
    const candidateScore = candidate.get(id);
    if (candidateScore !== undefined) {
      pairs.push({
        test_id: id,
        baseline_score: baselineScore,
        candidate_score: candidateScore,
        difference: candidateScore - baselineScore,
      });
    } else {
      baselineOnly.push(id);
    }
  }

  const candidateOnly: string[] = [];
  for (const id of candidate.keys()) {
    if (!baseline.has(id)) {
      candidateOnly.push(id);
    }
  }

  return { pairs, baselineOnly, candidateOnly };
}

function pairedBootstrapTest(
  differences: number[],
  iterations: number,
  alpha: number,
  rng: () => number,
): { ci_lower: number; ci_upper: number; p_value: number } {
  const n = differences.length;
  const observedMean = differences.reduce((a, b) => a + b, 0) / n;

  const bootstrapMeans: number[] = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      sum += differences[idx];
    }
    bootstrapMeans[i] = sum / n;
  }

  bootstrapMeans.sort((a, b) => a - b);

  // Confidence interval (percentile method)
  const ciLevel = 1 - alpha;
  const lowerIdx = Math.floor((alpha / 2) * iterations);
  const upperIdx = Math.floor((1 - alpha / 2) * iterations) - 1;
  const ci_lower = bootstrapMeans[Math.max(0, lowerIdx)];
  const ci_upper = bootstrapMeans[Math.min(iterations - 1, upperIdx)];

  // Two-sided p-value: proportion of bootstrap means on the opposite side of zero
  // (or crossing zero) relative to the observed mean
  let countExtreme = 0;
  if (observedMean >= 0) {
    for (const m of bootstrapMeans) {
      if (m <= 0) countExtreme++;
    }
  } else {
    for (const m of bootstrapMeans) {
      if (m >= 0) countExtreme++;
    }
  }
  // Two-sided: double the one-tail count, capped at 1
  const p_value = Math.min(1, (2 * countExtreme) / iterations);

  return {
    ci_lower: round(ci_lower, 6),
    ci_upper: round(ci_upper, 6),
    p_value: round(p_value, 6),
  };
}

function cohensD(differences: number[]): number | null {
  const n = differences.length;
  if (n < 2) return null;
  const mean = differences.reduce((a, b) => a + b, 0) / n;
  const variance = differences.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return null;
  return round(mean / sd, 4);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatVerdict(result: SignificanceResult): string {
  if (result.n_paired === 0) return 'No paired observations — cannot test.';
  if (result.n_paired < 5) return `Only ${result.n_paired} pairs — result unreliable.`;

  const dir =
    result.observed_mean_diff > 0
      ? 'candidate outperforms baseline'
      : result.observed_mean_diff < 0
        ? 'baseline outperforms candidate'
        : 'no difference';

  if (result.significant) {
    return `Significant (p=${result.bootstrap.p_value}): ${dir} by ${Math.abs(result.observed_mean_diff).toFixed(4)} (${result.metric}).`;
  }
  return `Not significant (p=${result.bootstrap.p_value}): ${dir} — difference of ${Math.abs(result.observed_mean_diff).toFixed(4)} (${result.metric}) is within sampling noise at α=${result.alpha}.`;
}

function printHumanReadable(result: SignificanceResult): void {
  const divider = '─'.repeat(72);

  console.log(`\n${divider}`);
  console.log('  Paired Bootstrap Significance Test');
  console.log(divider);
  console.log(`  Metric:               ${result.metric}`);
  console.log(`  Paired observations:  ${result.n_paired}`);

  if (result.n_unpaired_baseline > 0 || result.n_unpaired_candidate > 0) {
    console.log(
      `  Unpaired (skipped):   ${result.n_unpaired_baseline} baseline-only, ${result.n_unpaired_candidate} candidate-only`,
    );
  }

  console.log(divider);
  console.log(
    `  Observed mean diff:   ${result.observed_mean_diff.toFixed(6)}  (candidate − baseline)`,
  );

  if (result.effect_size_cohens_d !== null) {
    console.log(`  Effect size (d):      ${result.effect_size_cohens_d.toFixed(4)}`);
  }

  console.log(
    `  Bootstrap CI (${((1 - result.alpha) * 100).toFixed(0)}%):  [${result.bootstrap.ci_lower.toFixed(6)}, ${result.bootstrap.ci_upper.toFixed(6)}]`,
  );
  console.log(`  p-value:              ${result.bootstrap.p_value.toFixed(6)}`);
  console.log(`  α (significance):    ${result.alpha}`);
  console.log(`  Iterations:           ${result.bootstrap.iterations.toLocaleString()}`);
  console.log(divider);
  console.log(`  ▸ ${result.verdict}`);
  console.log(`${divider}\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(
      `Usage: bun significance-test.ts <baseline.jsonl> <candidate.jsonl> [options]

Performs a paired bootstrap significance test on two result files.
Records are aligned by test_id; unmatched IDs are reported and skipped.

Options:
  --metric <name>        Label for the metric (default: "score")
  --iterations <n>       Bootstrap iterations (default: 10000)
  --alpha <n>            Significance level (default: 0.05)
  --json                 Output machine-readable JSON only
  --seed <n>             RNG seed for reproducibility

Examples:
  bun significance-test.ts baseline.jsonl candidate.jsonl
  bun significance-test.ts baseline.jsonl candidate.jsonl --json --seed 42
  bun significance-test.ts baseline.jsonl candidate.jsonl --alpha 0.01 --iterations 50000`,
    );
    process.exit(0);
  }

  // Parse CLI args
  let baselinePath = '';
  let candidatePath = '';
  let metric = 'score';
  let iterations = 10000;
  let alpha = 0.05;
  let jsonOutput = false;
  let seed: number | null = null;

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--metric':
      case '-m':
        metric = args[++i];
        break;
      case '--iterations':
      case '-n':
        iterations = Number.parseInt(args[++i], 10);
        if (Number.isNaN(iterations) || iterations < 100) {
          console.error('Error: --iterations must be ≥ 100');
          process.exit(1);
        }
        break;
      case '--alpha':
      case '-a': {
        const val = Number.parseFloat(args[++i]);
        if (Number.isNaN(val) || val <= 0 || val >= 1) {
          console.error('Error: --alpha must be between 0 and 1 (exclusive)');
          process.exit(1);
        }
        alpha = val;
        break;
      }
      case '--json':
        jsonOutput = true;
        break;
      case '--seed':
      case '-s':
        seed = Number.parseInt(args[++i], 10);
        if (Number.isNaN(seed)) {
          console.error('Error: --seed must be an integer');
          process.exit(1);
        }
        break;
      default:
        positional.push(args[i]);
    }
  }

  if (positional.length < 2) {
    console.error('Error: two input files required (baseline.jsonl and candidate.jsonl).');
    process.exit(1);
  }

  baselinePath = resolve(positional[0]);
  candidatePath = resolve(positional[1]);

  // Read and align
  const baseline = readResultFile(baselinePath);
  const candidate = readResultFile(candidatePath);

  if (baseline.size === 0) {
    console.error(`Error: no valid records in baseline file: ${baselinePath}`);
    process.exit(1);
  }
  if (candidate.size === 0) {
    console.error(`Error: no valid records in candidate file: ${candidatePath}`);
    process.exit(1);
  }

  const { pairs, baselineOnly, candidateOnly } = alignPairs(baseline, candidate);

  // Warn about unmatched pairs to stderr (doesn't interfere with JSON output)
  if (baselineOnly.length > 0 || candidateOnly.length > 0) {
    console.error(
      `Note: ${baselineOnly.length} baseline-only and ${candidateOnly.length} candidate-only test IDs skipped.`,
    );
  }

  // Compute
  const differences = pairs.map((p) => p.difference);

  const observedMeanDiff =
    differences.length > 0
      ? round(differences.reduce((a, b) => a + b, 0) / differences.length, 6)
      : 0;

  // Use provided seed or generate a deterministic one from data characteristics
  const effectiveSeed = seed ?? Math.abs(Math.imul(differences.length, 2654435761)) | 1;
  const rng = makeRng(effectiveSeed);

  let bootstrapResult = { ci_lower: 0, ci_upper: 0, p_value: 1 };
  if (differences.length >= 2) {
    bootstrapResult = pairedBootstrapTest(differences, iterations, alpha, rng);
  }

  const result: SignificanceResult = {
    method: 'paired_bootstrap',
    metric,
    n_paired: pairs.length,
    n_unpaired_baseline: baselineOnly.length,
    n_unpaired_candidate: candidateOnly.length,
    unpaired_ids: {
      baseline_only: baselineOnly,
      candidate_only: candidateOnly,
    },
    observed_mean_diff: observedMeanDiff,
    effect_size_cohens_d: cohensD(differences),
    bootstrap: {
      iterations,
      ci_lower: bootstrapResult.ci_lower,
      ci_upper: bootstrapResult.ci_upper,
      ci_level: round(1 - alpha, 4),
      p_value: bootstrapResult.p_value,
    },
    alpha,
    significant: bootstrapResult.p_value < alpha,
    verdict: '',
    seed: seed,
  };

  result.verdict = formatVerdict(result);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanReadable(result);
  }

  // Exit non-zero if not enough pairs to test
  if (pairs.length < 2) {
    process.exit(1);
  }
}

main();
