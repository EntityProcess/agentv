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
  passRate: number;
  totalDurationMs: number;
  totalTokens: number;
  failedTestIds: string[];
}

export function formatSummary(results: EvaluationResult[]): SummaryJson {
  const total = results.length;
  const passed = results.filter((r) => r.score >= 1.0).length;
  const failed = total - passed;
  // passRate = mean of per-test scores (each score is the assertion pass rate for that test,
  // matching skill-creator's pass_rate.mean semantics)
  const passRate =
    total > 0 ? Math.round((results.reduce((s, r) => s + r.score, 0) / total) * 1000) / 1000 : 0;

  let totalDurationMs = 0;
  let totalTokens = 0;
  for (const r of results) {
    if (r.durationMs != null) totalDurationMs += r.durationMs;
    const usage = r.tokenUsage as { input?: number; output?: number } | undefined;
    if (usage) totalTokens += (usage.input ?? 0) + (usage.output ?? 0);
  }

  const failedTestIds = results.filter((r) => r.score < 1.0).map((r) => r.testId);

  return { total, passed, failed, passRate, totalDurationMs, totalTokens, failedTestIds };
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
