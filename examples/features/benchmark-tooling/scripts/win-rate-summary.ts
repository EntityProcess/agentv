#!/usr/bin/env bun
/**
 * win-rate-summary — Aggregate win/loss/tie rates from agentv compare output.
 *
 * Usage:
 *   bun win-rate-summary.ts <comparison.json> [--tolerance <n>] [--json]
 *   bun win-rate-summary.ts <dir-of-comparisons/> [--tolerance <n>] [--json]
 *
 * Input: JSON output from `agentv compare --json`, saved to a file.
 *        When a directory is given, all .json files are read and each is
 *        treated as a separate metric (filename becomes the metric label).
 *
 * Tie Policy:
 *   A result is classified as a "tie" when |delta| < tolerance.
 *   Default tolerance: 0.1 (same as agentv compare default threshold).
 *   Set --tolerance 0 for strict comparison (no ties unless delta == 0).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatchedRecord {
  test_id: string;
  score1: number;
  score2: number;
  delta: number;
  outcome: string;
}

interface ComparisonInput {
  matched: MatchedRecord[];
  unmatched?: { file1: number; file2: number };
  summary?: {
    total: number;
    matched: number;
    wins: number;
    losses: number;
    ties: number;
    mean_delta: number;
  };
}

interface WinRateBucket {
  label: string;
  total: number;
  wins: number;
  losses: number;
  ties: number;
  win_rate: number;
  loss_rate: number;
  tie_rate: number;
  mean_delta: number;
}

interface WinRateSummary {
  tolerance: number;
  tie_policy: string;
  overall: WinRateBucket;
  per_metric: WinRateBucket[] | null;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function classifyOutcome(
  delta: number,
  tolerance: number,
): "win" | "loss" | "tie" {
  if (delta >= tolerance) return "win";
  if (delta <= -tolerance) return "loss";
  return "tie";
}

function computeBucket(
  label: string,
  records: MatchedRecord[],
  tolerance: number,
): WinRateBucket {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let sumDelta = 0;

  for (const r of records) {
    const outcome = classifyOutcome(r.delta, tolerance);
    if (outcome === "win") wins++;
    else if (outcome === "loss") losses++;
    else ties++;
    sumDelta += r.delta;
  }

  const total = records.length;
  return {
    label,
    total,
    wins,
    losses,
    ties,
    win_rate: total > 0 ? round(wins / total, 4) : 0,
    loss_rate: total > 0 ? round(losses / total, 4) : 0,
    tie_rate: total > 0 ? round(ties / total, 4) : 0,
    mean_delta: total > 0 ? round(sumDelta / total, 4) : 0,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

function readComparisonFile(filePath: string): ComparisonInput {
  const raw = readFileSync(filePath, "utf-8").trim();
  try {
    return JSON.parse(raw) as ComparisonInput;
  } catch {
    console.error(`Error: could not parse JSON from ${filePath}`);
    process.exit(1);
  }
}

function loadInputs(
  inputPath: string,
): { label: string; data: ComparisonInput }[] {
  const stat = statSync(inputPath);

  if (stat.isDirectory()) {
    const files = readdirSync(inputPath)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length === 0) {
      console.error(`Error: no .json files found in ${inputPath}`);
      process.exit(1);
    }
    return files.map((f) => ({
      label: basename(f, ".json"),
      data: readComparisonFile(resolve(inputPath, f)),
    }));
  }

  return [{ label: "overall", data: readComparisonFile(inputPath) }];
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function printTable(summary: WinRateSummary): void {
  const divider = "─".repeat(72);

  console.log(`\n${divider}`);
  console.log("  Win-Rate Summary");
  console.log(divider);
  console.log(`  Tolerance: ${summary.tolerance}  (${summary.tie_policy})`);
  console.log(divider);

  const header = [
    pad("Metric", 20),
    pad("Total", 7),
    pad("Wins", 7),
    pad("Losses", 7),
    pad("Ties", 7),
    pad("Win%", 8),
    pad("Loss%", 8),
    pad("Tie%", 8),
  ].join("");
  console.log(header);
  console.log("─".repeat(72));

  const printRow = (b: WinRateBucket) => {
    const row = [
      pad(b.label, 20),
      pad(String(b.total), 7),
      pad(String(b.wins), 7),
      pad(String(b.losses), 7),
      pad(String(b.ties), 7),
      pad(pct(b.win_rate), 8),
      pad(pct(b.loss_rate), 8),
      pad(pct(b.tie_rate), 8),
    ].join("");
    console.log(row);
  };

  if (summary.per_metric && summary.per_metric.length > 1) {
    for (const bucket of summary.per_metric) {
      printRow(bucket);
    }
    console.log("─".repeat(72));
  }

  printRow(summary.overall);
  console.log(`\n  Mean delta: ${summary.overall.mean_delta}`);
  console.log(divider);
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(
      `Usage: bun win-rate-summary.ts <comparison.json | dir/> [--tolerance <n>] [--json]

Reads JSON output from \`agentv compare --json\` and computes aggregate win/loss/tie rates.

Options:
  --tolerance <n>  Delta tolerance for tie classification (default: 0.1)
  --json           Output machine-readable JSON instead of a table

Tie Policy:
  A result is a "tie" when |delta| < tolerance.
  Use --tolerance 0 for strict comparison (no ties unless delta is exactly 0).

Per-Metric Breakdown:
  Pass a directory containing multiple comparison .json files.
  Each file is treated as a separate metric; the filename becomes the label.

Examples:
  agentv compare baseline.jsonl candidate.jsonl --json > comparison.json
  bun win-rate-summary.ts comparison.json
  bun win-rate-summary.ts comparison.json --tolerance 0.05 --json
  bun win-rate-summary.ts ./comparisons/              # per-metric from directory`,
    );
    process.exit(0);
  }

  // Parse CLI args
  let inputPath = "";
  let tolerance = 0.1;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tolerance" || args[i] === "-t") {
      const val = Number.parseFloat(args[++i]);
      if (Number.isNaN(val) || val < 0) {
        console.error("Error: --tolerance must be a non-negative number");
        process.exit(1);
      }
      tolerance = val;
    } else if (args[i] === "--json") {
      jsonOutput = true;
    } else if (!inputPath) {
      inputPath = resolve(args[i]);
    }
  }

  if (!inputPath) {
    console.error("Error: no input file or directory specified.");
    process.exit(1);
  }

  // Load and compute
  const inputs = loadInputs(inputPath);
  const allRecords: MatchedRecord[] = [];
  const perMetric: WinRateBucket[] = [];

  for (const { label, data } of inputs) {
    if (!data.matched || !Array.isArray(data.matched)) {
      console.error(
        `Error: "${label}" has no matched array. Is this agentv compare --json output?`,
      );
      process.exit(1);
    }
    allRecords.push(...data.matched);
    perMetric.push(computeBucket(label, data.matched, tolerance));
  }

  const overall = computeBucket("overall", allRecords, tolerance);

  const summary: WinRateSummary = {
    tolerance,
    tie_policy: `|delta| < ${tolerance} is classified as a tie`,
    overall,
    per_metric: perMetric.length > 1 ? perMetric : null,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printTable(summary);
  }
}

main();
