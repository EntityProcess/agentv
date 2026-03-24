/**
 * `agentv results summary` — compact pass/fail summary of an eval run.
 *
 * Outputs JSON with:
 *   - Total tests, passed, failed, pass rate
 *   - Mean score, total duration, total tokens
 *   - List of failed test IDs
 *
 * How to extend:
 *   - To add new summary fields, update formatSummary and the SummaryJson interface.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { EvaluationResult } from '@agentv/core';
import { command, option, optional, string } from 'cmd-ts';
import type { AggregateGradingArtifact } from '../eval/artifact-writer.js';
import { loadResults, sourceArg } from './shared.js';

// ── Formatting ───────────────────────────────────────────────────────────

export interface SummaryJson {
  total: number;
  passed: number;
  failed: number;
  pass_rate: { mean: number };
  total_duration_ms: number;
  total_tokens: number;
  failed_test_ids: string[];
}

export function formatSummary(
  results: EvaluationResult[],
  grading?: AggregateGradingArtifact,
): SummaryJson {
  const total = results.length;

  let passed: number;
  let failed: number;
  let passRate: number;

  if (grading) {
    // Use pre-computed assertion-level counts from grading artifact
    passed = grading.summary.passed;
    failed = grading.summary.failed;
    passRate = grading.summary.pass_rate;
  } else {
    // Fall back to computing from per-test scores
    passed = results.filter((r) => r.score >= 1.0).length;
    failed = total - passed;
    passRate =
      total > 0 ? Math.round((results.reduce((s, r) => s + r.score, 0) / total) * 1000) / 1000 : 0;
  }

  let totalDurationMs = 0;
  let totalTokens = 0;
  for (const r of results) {
    if (r.durationMs != null) totalDurationMs += r.durationMs;
    const usage = r.tokenUsage as { input?: number; output?: number } | undefined;
    if (usage) totalTokens += (usage.input ?? 0) + (usage.output ?? 0);
  }

  const failedTestIds = results.filter((r) => r.score < 1.0).map((r) => r.testId);

  return {
    total,
    passed,
    failed,
    pass_rate: { mean: passRate },
    total_duration_ms: totalDurationMs,
    total_tokens: totalTokens,
    failed_test_ids: failedTestIds,
  };
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsSummaryCommand = command({
  name: 'summary',
  description: 'Show compact pass/fail summary of eval results',
  args: {
    source: sourceArg,
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, dir }) => {
    const cwd = dir ?? process.cwd();
    try {
      const { results, sourceFile } = await loadResults(source, cwd);

      // Try to load companion grading.json
      let grading: AggregateGradingArtifact | undefined;
      const gradingPath = sourceFile.replace(/\.jsonl$/, '.grading.json');
      if (existsSync(gradingPath)) {
        try {
          grading = JSON.parse(readFileSync(gradingPath, 'utf8'));
        } catch {
          // Fall back to JSONL-only computation
        }
      }

      console.log(JSON.stringify(formatSummary(results, grading), null, 2));
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
