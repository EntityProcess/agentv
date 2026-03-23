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

import type { EvaluationResult } from '@agentv/core';
import { command, option, optional, string } from 'cmd-ts';
import { loadResults, sourceArg } from './shared.js';

// ── Formatting ───────────────────────────────────────────────────────────

export interface SummaryJson {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  total_duration_ms: number;
  total_tokens: number;
  failed_test_ids: string[];
}

export function formatSummary(results: EvaluationResult[]): SummaryJson {
  const total = results.length;
  const passed = results.filter((r) => r.score >= 1.0).length;
  const failed = total - passed;
  // pass_rate = mean of per-test scores (each score is the assertion pass rate for that test,
  // matching skill-creator's pass_rate.mean semantics)
  const pass_rate =
    total > 0 ? Math.round((results.reduce((s, r) => s + r.score, 0) / total) * 1000) / 1000 : 0;

  let total_duration_ms = 0;
  let total_tokens = 0;
  for (const r of results) {
    if (r.durationMs != null) total_duration_ms += r.durationMs;
    const usage = r.tokenUsage as { input?: number; output?: number } | undefined;
    if (usage) total_tokens += (usage.input ?? 0) + (usage.output ?? 0);
  }

  const failed_test_ids = results.filter((r) => r.score < 1.0).map((r) => r.testId);

  return { total, passed, failed, pass_rate, total_duration_ms, total_tokens, failed_test_ids };
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
      const { results } = await loadResults(source, cwd);
      console.log(JSON.stringify(formatSummary(results), null, 2));
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
