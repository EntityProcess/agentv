/**
 * `agentv results export` — converts JSONL eval results into a per-test
 * directory structure compatible with agentv-bench's workspace layout.
 *
 * Output structure:
 *   <output-dir>/
 *     benchmark.json       — aggregate scores, pass/fail counts, timing
 *     <test-id>/
 *       grading.json       — per-assertion results (hits, misses, evaluator details)
 *       timing.json        — tokens, duration, cost, tool names
 *       outputs/           — raw agent output text
 *
 * How to extend:
 *   - To add a new aggregate field to benchmark.json, update `buildBenchmark()`.
 *   - To include additional per-test data, add a new file writer in `exportTestCase()`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';

import {
  type RawResult,
  extractTimestampFromFilename,
  listResultFiles,
  loadResultFile,
} from '../trace/utils.js';

// ── Types ───────────────────────────────────────────────────────────────

interface BenchmarkJson {
  metadata: {
    eval_file: string;
    timestamp: string;
    tests_run: number;
  };
  run_summary: Record<string, TargetSummary>;
}

interface TargetSummary {
  pass_rate: { mean: number };
  time_seconds: { mean: number };
  tokens: { mean: number };
  cost_usd: { mean: number };
}

interface GradingJson {
  id: string;
  verdict: 'pass' | 'fail';
  score: number;
  evaluators: readonly GradingEvaluator[];
  hits: readonly string[];
  misses: readonly string[];
}

interface GradingEvaluator {
  name: string;
  type: string;
  score: number;
  reasoning?: string;
  hits?: readonly string[];
  misses?: readonly string[];
}

interface TimingJson {
  eventCount: number;
  toolNames: readonly string[];
  tokenUsage: { input: number; output: number; cached: number };
  costUsd: number;
  durationMs: number;
  llmCallCount: number;
}

// ── Builders ────────────────────────────────────────────────────────────

function buildBenchmark(results: RawResult[], sourceFile: string): BenchmarkJson {
  const timestamp =
    results[0]?.timestamp ?? extractTimestampFromFilename(path.basename(sourceFile)) ?? 'unknown';

  // Group results by target
  const byTarget = new Map<string, RawResult[]>();
  for (const r of results) {
    const target = r.target ?? 'default';
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target)?.push(r);
  }

  const runSummary: Record<string, TargetSummary> = {};

  for (const [target, group] of byTarget) {
    const n = group.length;
    const passCount = group.filter((r) => r.score >= 1.0).length;
    const totalDurationMs = group.reduce(
      (sum, r) => sum + (r.trace?.duration_ms ?? r.duration_ms ?? 0),
      0,
    );
    const totalTokens = group.reduce((sum, r) => {
      const tu = r.trace?.token_usage ?? r.token_usage;
      return sum + (tu ? tu.input + tu.output : 0);
    }, 0);
    const totalCost = group.reduce((sum, r) => sum + (r.trace?.cost_usd ?? r.cost_usd ?? 0), 0);

    runSummary[target] = {
      pass_rate: { mean: round(passCount / n) },
      time_seconds: { mean: round(totalDurationMs / n / 1000) },
      tokens: { mean: round(totalTokens / n) },
      cost_usd: { mean: round(totalCost / n) },
    };
  }

  return {
    metadata: {
      eval_file: sourceFile,
      timestamp,
      tests_run: results.length,
    },
    run_summary: runSummary,
  };
}

function buildGrading(result: RawResult): GradingJson {
  const evaluators: GradingEvaluator[] = (result.scores ?? []).map((s) => ({
    name: s.name,
    type: s.type,
    score: s.score,
    reasoning: s.reasoning,
    hits: s.hits,
    misses: s.misses,
  }));

  return {
    id: result.test_id ?? result.eval_id ?? 'unknown',
    verdict: result.score >= 1.0 ? 'pass' : 'fail',
    score: result.score,
    evaluators,
    hits: result.hits ?? [],
    misses: result.misses ?? [],
  };
}

function buildTiming(result: RawResult): TimingJson {
  const trace = result.trace;
  const tu = trace?.token_usage ?? result.token_usage;

  return {
    eventCount: trace?.event_count ?? 0,
    toolNames: trace?.tool_names ?? [],
    tokenUsage: {
      input: tu?.input ?? 0,
      output: tu?.output ?? 0,
      cached: tu?.cached ?? 0,
    },
    costUsd: trace?.cost_usd ?? result.cost_usd ?? 0,
    durationMs: trace?.duration_ms ?? result.duration_ms ?? 0,
    llmCallCount: trace?.llm_call_count ?? 0,
  };
}

// ── Export logic ─────────────────────────────────────────────────────────

function exportTestCase(result: RawResult, outputDir: string): void {
  const testId = result.test_id ?? result.eval_id ?? 'unknown';
  const testDir = path.join(outputDir, testId);
  const outputsDir = path.join(testDir, 'outputs');

  mkdirSync(outputsDir, { recursive: true });

  // grading.json
  writeFileSync(path.join(testDir, 'grading.json'), JSON.stringify(buildGrading(result), null, 2));

  // timing.json
  writeFileSync(path.join(testDir, 'timing.json'), JSON.stringify(buildTiming(result), null, 2));

  // outputs/answer.txt — raw agent response text
  const answer = result.answer;
  if (answer) {
    writeFileSync(path.join(outputsDir, 'answer.txt'), answer);
  }
}

export function exportResults(sourceFile: string, results: RawResult[], outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });

  // benchmark.json
  const benchmark = buildBenchmark(results, sourceFile);
  writeFileSync(path.join(outputDir, 'benchmark.json'), JSON.stringify(benchmark, null, 2));

  // Per-test directories
  for (const result of results) {
    exportTestCase(result, outputDir);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/**
 * Derive the default output directory from a JSONL filename.
 * e.g. eval_2026-03-18T12-00-00-000Z.jsonl → .agentv/results/2026-03-18T12-00-00-000Z/
 */
function deriveOutputDir(cwd: string, sourceFile: string): string {
  const basename = path.basename(sourceFile, '.jsonl');
  // Strip leading "eval_" prefix if present to get the timestamp
  const dirName = basename.startsWith('eval_') ? basename.slice(5) : basename;
  return path.join(cwd, '.agentv', 'results', dirName);
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsExportCommand = command({
  name: 'export',
  description: 'Export JSONL eval results into a per-test directory structure',
  args: {
    source: positional({
      type: optional(string),
      displayName: 'source',
      description: 'JSONL result file to export (defaults to most recent in .agentv/results/)',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      short: 'o',
      description: 'Output directory (defaults to .agentv/results/<run-timestamp>/)',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, out, dir }) => {
    const cwd = dir ?? process.cwd();

    try {
      let sourceFile: string;

      if (source) {
        // Explicit source file
        sourceFile = path.isAbsolute(source) ? source : path.resolve(cwd, source);
      } else {
        // Find most recent result file
        const metas = listResultFiles(cwd, 1);
        if (metas.length === 0) {
          console.error('Error: No result files found in .agentv/results/');
          console.error('Run an evaluation first: agentv eval <eval-file>');
          process.exit(1);
        }
        sourceFile = metas[0].path;
      }

      const results = loadResultFile(sourceFile);

      if (results.length === 0) {
        console.error(`Error: No results found in ${sourceFile}`);
        process.exit(1);
      }

      const outputDir = out
        ? path.isAbsolute(out)
          ? out
          : path.resolve(cwd, out)
        : deriveOutputDir(cwd, sourceFile);

      exportResults(sourceFile, results, outputDir);

      const testIds = results.map((r) => r.test_id ?? r.eval_id ?? 'unknown');
      console.log(`Exported ${results.length} test(s) to ${outputDir}`);
      for (const id of testIds) {
        console.log(`  ${id}/`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
