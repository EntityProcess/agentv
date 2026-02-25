#!/usr/bin/env bun
/**
 * benchmark-report — Consolidated benchmark summary across models and metrics.
 *
 * Reads multiple result JSONL files (one per model/target) and produces a
 * summary report with per-target aggregates, per-metric breakdowns, and
 * overall statistics including uncertainty measures.
 *
 * Usage:
 *   bun benchmark-report.ts <file1.jsonl> [file2.jsonl ...] [options]
 *   bun benchmark-report.ts <dir/> [options]
 *
 * Options:
 *   --json            Output machine-readable JSON only
 *   --format <fmt>    Output format: "markdown" (default) or "json"
 *   --sort <field>    Sort targets by: "name" (default), "score", "pass_rate"
 *   --pass-threshold  Score threshold to count as pass (default: 0.5)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResultRecord {
  test_id?: string;
  eval_id?: string;
  target?: string;
  score: number;
  scores?: EvaluatorScore[];
  trials?: TrialRecord[];
  aggregation?: AggregationInfo;
}

interface EvaluatorScore {
  name: string;
  type?: string;
  score: number;
  weight?: number;
  verdict?: string;
}

interface TrialRecord {
  attempt: number;
  score: number;
  verdict?: string;
}

interface AggregationInfo {
  strategy?: string;
  mean?: number;
  min?: number;
  max?: number;
  ci95_lower?: number;
  ci95_upper?: number;
  stddev?: number;
  passed_attempts?: number;
  total_attempts?: number;
}

interface TargetStats {
  target: string;
  n: number;
  mean_score: number;
  std_dev: number;
  min_score: number;
  max_score: number;
  median_score: number;
  pass_count: number;
  pass_rate: number;
  ci95_lower: number | null;
  ci95_upper: number | null;
}

interface MetricStats {
  metric: string;
  n: number;
  mean_score: number;
  std_dev: number;
  min_score: number;
  max_score: number;
}

interface TargetMetricStats {
  target: string;
  metrics: MetricStats[];
}

interface BenchmarkReport {
  summary: {
    total_records: number;
    total_targets: number;
    total_test_ids: number;
    pass_threshold: number;
  };
  per_target: TargetStats[];
  per_target_metrics: TargetMetricStats[] | null;
  overall: TargetStats;
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ci95(values: number[]): { lower: number; upper: number } | null {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  const se = stdDev(values) / Math.sqrt(n);
  // t-approximation for 95% CI (use 1.96 for large n)
  const t = n >= 30 ? 1.96 : tValue95(n - 1);
  return {
    lower: round(m - t * se, 6),
    upper: round(m + t * se, 6),
  };
}

/** Approximate t-value for 95% CI with small df. */
function tValue95(df: number): number {
  // Pre-computed t-values for small degrees of freedom (two-tailed 95%)
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    15: 2.131, 20: 2.086, 25: 2.06, 29: 2.045,
  };
  if (table[df]) return table[df];
  // Find nearest lower df in table
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= df) return table[keys[i]];
  }
  return 1.96;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function readResultFile(
  filePath: string,
  fallbackTarget: string,
): ResultRecord[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const records: ResultRecord[] = [];

  for (const line of lines) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof raw.score !== "number") continue;

    const record: ResultRecord = {
      test_id: (raw.test_id ?? raw.eval_id) as string | undefined,
      target: (raw.target as string) ?? fallbackTarget,
      score: raw.score as number,
    };

    if (Array.isArray(raw.scores)) {
      record.scores = raw.scores as EvaluatorScore[];
    }
    if (Array.isArray(raw.trials)) {
      record.trials = raw.trials as TrialRecord[];
    }
    if (raw.aggregation && typeof raw.aggregation === "object") {
      record.aggregation = raw.aggregation as AggregationInfo;
    }

    records.push(record);
  }

  return records;
}

function loadRecords(inputPaths: string[]): ResultRecord[] {
  const all: ResultRecord[] = [];

  for (const inputPath of inputPaths) {
    const stat = statSync(inputPath);

    if (stat.isDirectory()) {
      const files = readdirSync(inputPath)
        .filter((f) => f.endsWith(".jsonl"))
        .sort();
      if (files.length === 0) {
        console.error(`Warning: no .jsonl files found in ${inputPath}`);
        continue;
      }
      for (const f of files) {
        const fullPath = resolve(inputPath, f);
        const fallback = basename(f, ".jsonl").replace(/^results\./, "");
        all.push(...readResultFile(fullPath, fallback));
      }
    } else {
      const fallback = basename(inputPath, ".jsonl").replace(/^results\./, "");
      all.push(...readResultFile(inputPath, fallback));
    }
  }

  return all;
}

function computeTargetStats(
  target: string,
  records: ResultRecord[],
  passThreshold: number,
): TargetStats {
  const scores = records.map((r) => r.score);
  const passCount = scores.filter((s) => s >= passThreshold).length;
  const confidence = ci95(scores);

  // Check for trial-level uncertainty
  let trialCiLower: number | null = null;
  let trialCiUpper: number | null = null;
  for (const r of records) {
    if (r.aggregation?.ci95_lower != null && r.aggregation?.ci95_upper != null) {
      trialCiLower = r.aggregation.ci95_lower;
      trialCiUpper = r.aggregation.ci95_upper;
      break; // Use first available as representative
    }
  }

  return {
    target,
    n: scores.length,
    mean_score: round(mean(scores), 4),
    std_dev: round(stdDev(scores), 4),
    min_score: round(Math.min(...scores), 4),
    max_score: round(Math.max(...scores), 4),
    median_score: round(median(scores), 4),
    pass_count: passCount,
    pass_rate: round(scores.length > 0 ? passCount / scores.length : 0, 4),
    ci95_lower: confidence?.lower ?? trialCiLower,
    ci95_upper: confidence?.upper ?? trialCiUpper,
  };
}

function computeMetricStats(
  records: ResultRecord[],
): Map<string, number[]> | null {
  const metricScores = new Map<string, number[]>();
  let hasMetrics = false;

  for (const r of records) {
    if (!r.scores || !Array.isArray(r.scores)) continue;
    for (const s of r.scores) {
      if (!s.name || typeof s.score !== "number") continue;
      hasMetrics = true;
      const existing = metricScores.get(s.name) ?? [];
      existing.push(s.score);
      metricScores.set(s.name, existing);
    }
  }

  return hasMetrics ? metricScores : null;
}

function buildReport(
  records: ResultRecord[],
  passThreshold: number,
  sortBy: string,
): BenchmarkReport {
  // Group by target
  const byTarget = new Map<string, ResultRecord[]>();
  const testIds = new Set<string>();

  for (const r of records) {
    const target = r.target ?? "unknown";
    const group = byTarget.get(target) ?? [];
    group.push(r);
    byTarget.set(target, group);
    if (r.test_id) testIds.add(r.test_id);
  }

  // Per-target stats
  const perTarget: TargetStats[] = [];
  for (const [target, recs] of byTarget) {
    perTarget.push(computeTargetStats(target, recs, passThreshold));
  }

  // Sort
  switch (sortBy) {
    case "score":
      perTarget.sort((a, b) => b.mean_score - a.mean_score);
      break;
    case "pass_rate":
      perTarget.sort((a, b) => b.pass_rate - a.pass_rate);
      break;
    default:
      perTarget.sort((a, b) => a.target.localeCompare(b.target));
  }

  // Per-target per-metric stats
  let perTargetMetrics: TargetMetricStats[] | null = null;
  const anyMetrics = records.some(
    (r) => r.scores && Array.isArray(r.scores) && r.scores.length > 0,
  );

  if (anyMetrics) {
    perTargetMetrics = [];
    for (const [target, recs] of byTarget) {
      const metricMap = computeMetricStats(recs);
      if (!metricMap) continue;

      const metrics: MetricStats[] = [];
      for (const [name, scores] of metricMap) {
        metrics.push({
          metric: name,
          n: scores.length,
          mean_score: round(mean(scores), 4),
          std_dev: round(stdDev(scores), 4),
          min_score: round(Math.min(...scores), 4),
          max_score: round(Math.max(...scores), 4),
        });
      }
      metrics.sort((a, b) => a.metric.localeCompare(b.metric));
      perTargetMetrics.push({ target, metrics });
    }
    // Sort to match per_target order
    const targetOrder = new Map(perTarget.map((t, i) => [t.target, i]));
    perTargetMetrics.sort(
      (a, b) => (targetOrder.get(a.target) ?? 0) - (targetOrder.get(b.target) ?? 0),
    );
  }

  // Overall stats
  const overall = computeTargetStats("overall", records, passThreshold);

  return {
    summary: {
      total_records: records.length,
      total_targets: byTarget.size,
      total_test_ids: testIds.size,
      pass_threshold: passThreshold,
    },
    per_target: perTarget,
    per_target_metrics: perTargetMetrics,
    overall,
  };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function padLeft(str: string, width: number): string {
  return str.length >= width ? str : " ".repeat(width - str.length) + str;
}

function formatCI(lower: number | null, upper: number | null): string {
  if (lower == null || upper == null) return "—";
  return `[${lower.toFixed(4)}, ${upper.toFixed(4)}]`;
}

function printMarkdown(report: BenchmarkReport): void {
  const divider = "─".repeat(80);

  console.log(`\n${divider}`);
  console.log("  Benchmark Report");
  console.log(divider);
  console.log(
    `  Records: ${report.summary.total_records}  |  Targets: ${report.summary.total_targets}  |  Test IDs: ${report.summary.total_test_ids}  |  Pass threshold: ${report.summary.pass_threshold}`,
  );
  console.log(divider);

  // Per-target table
  console.log("\n## Per-Target Summary\n");
  console.log(
    [
      pad("Target", 22),
      padLeft("N", 5),
      padLeft("Mean", 8),
      padLeft("Std", 8),
      padLeft("Med", 8),
      padLeft("Min", 8),
      padLeft("Max", 8),
      padLeft("Pass%", 8),
      pad("  95% CI", 24),
    ].join(""),
  );
  console.log("─".repeat(99));

  for (const t of report.per_target) {
    console.log(
      [
        pad(t.target.slice(0, 21), 22),
        padLeft(String(t.n), 5),
        padLeft(t.mean_score.toFixed(4), 8),
        padLeft(t.std_dev.toFixed(4), 8),
        padLeft(t.median_score.toFixed(4), 8),
        padLeft(t.min_score.toFixed(4), 8),
        padLeft(t.max_score.toFixed(4), 8),
        padLeft(pct(t.pass_rate), 8),
        `  ${formatCI(t.ci95_lower, t.ci95_upper)}`,
      ].join(""),
    );
  }

  console.log("─".repeat(99));

  // Overall row
  const o = report.overall;
  console.log(
    [
      pad("overall", 22),
      padLeft(String(o.n), 5),
      padLeft(o.mean_score.toFixed(4), 8),
      padLeft(o.std_dev.toFixed(4), 8),
      padLeft(o.median_score.toFixed(4), 8),
      padLeft(o.min_score.toFixed(4), 8),
      padLeft(o.max_score.toFixed(4), 8),
      padLeft(pct(o.pass_rate), 8),
      `  ${formatCI(o.ci95_lower, o.ci95_upper)}`,
    ].join(""),
  );

  // Per-target per-metric breakdown
  if (report.per_target_metrics && report.per_target_metrics.length > 0) {
    console.log("\n## Per-Target Metric Breakdown\n");

    for (const tm of report.per_target_metrics) {
      console.log(`### ${tm.target}\n`);
      console.log(
        [
          pad("Metric", 22),
          padLeft("N", 5),
          padLeft("Mean", 8),
          padLeft("Std", 8),
          padLeft("Min", 8),
          padLeft("Max", 8),
        ].join(""),
      );
      console.log("─".repeat(59));

      for (const m of tm.metrics) {
        console.log(
          [
            pad(m.metric.slice(0, 21), 22),
            padLeft(String(m.n), 5),
            padLeft(m.mean_score.toFixed(4), 8),
            padLeft(m.std_dev.toFixed(4), 8),
            padLeft(m.min_score.toFixed(4), 8),
            padLeft(m.max_score.toFixed(4), 8),
          ].join(""),
        );
      }
      console.log();
    }
  }

  console.log(divider);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(
      `Usage: bun benchmark-report.ts <file.jsonl ...> [options]
       bun benchmark-report.ts <dir/> [options]

Generates a consolidated benchmark summary from multiple result JSONL files.
Aggregates per-target (model) and per-metric statistics with uncertainty.

Options:
  --json                 Output machine-readable JSON only
  --sort <field>         Sort targets by: "name" (default), "score", "pass_rate"
  --pass-threshold <n>   Score threshold to count as pass (default: 0.5)

Input:
  One or more .jsonl result files, or a directory containing .jsonl files.
  Each record must have a "score" field. The "target" field identifies
  the model; if absent, the filename is used as fallback.

Examples:
  bun benchmark-report.ts results.gpt-4.1.jsonl results.claude-sonnet-4.jsonl
  bun benchmark-report.ts ./by-target/
  bun benchmark-report.ts ./by-target/ --json --sort score
  bun benchmark-report.ts ./by-target/ --pass-threshold 0.7`,
    );
    process.exit(0);
  }

  // Parse CLI args
  let jsonOutput = false;
  let sortBy = "name";
  let passThreshold = 0.5;
  const inputPaths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--json":
        jsonOutput = true;
        break;
      case "--format":
      case "-f": {
        const fmt = args[++i];
        if (fmt === "json") jsonOutput = true;
        break;
      }
      case "--sort":
      case "-s":
        sortBy = args[++i];
        if (!["name", "score", "pass_rate"].includes(sortBy)) {
          console.error(
            'Error: --sort must be one of: "name", "score", "pass_rate"',
          );
          process.exit(1);
        }
        break;
      case "--pass-threshold":
      case "-p": {
        const val = Number.parseFloat(args[++i]);
        if (Number.isNaN(val) || val < 0 || val > 1) {
          console.error("Error: --pass-threshold must be between 0 and 1");
          process.exit(1);
        }
        passThreshold = val;
        break;
      }
      default:
        inputPaths.push(resolve(args[i]));
    }
  }

  if (inputPaths.length === 0) {
    console.error("Error: no input files or directories specified.");
    process.exit(1);
  }

  // Load all records
  const records = loadRecords(inputPaths);

  if (records.length === 0) {
    console.error("Error: no valid result records found in input files.");
    process.exit(1);
  }

  // Build report
  const report = buildReport(records, passThreshold, sortBy);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printMarkdown(report);
  }
}

main();
