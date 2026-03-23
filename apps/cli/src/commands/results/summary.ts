/**
 * `agentv results summary` — compact pass/fail summary of an eval run.
 *
 * Outputs minimal text optimized for AI consumption (few tokens):
 *   - Total tests, passed, failed, pass rate
 *   - Mean score, total duration, total tokens
 *   - List of failed test IDs
 *
 * Supports --format json for programmatic use.
 *
 * How to extend:
 *   - To add new summary fields, update both formatSummaryMarkdown and formatSummaryJson.
 */

import { command, option, optional, string } from 'cmd-ts';
import type { EvaluationResult } from '@agentv/core';
import { formatOption, loadResults, sourceArg } from './shared.js';

// ── Formatting ───────────────────────────────────────────────────────────

export function formatSummaryMarkdown(results: EvaluationResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.score >= 1.0).length;
  const failed = total - passed;
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  const meanScore = total > 0 ? results.reduce((s, r) => s + r.score, 0) / total : 0;

  let totalDurationMs = 0;
  let totalTokens = 0;
  for (const r of results) {
    if (r.durationMs != null) totalDurationMs += r.durationMs;
    const usage = r.tokenUsage as { input?: number; output?: number } | undefined;
    if (usage) totalTokens += (usage.input ?? 0) + (usage.output ?? 0);
  }

  const durationStr =
    totalDurationMs < 1000
      ? `${Math.round(totalDurationMs)}ms`
      : `${(totalDurationMs / 1000).toFixed(1)}s`;

  const failedIds = results.filter((r) => r.score < 1.0).map((r) => r.testId);

  const lines: string[] = [];
  lines.push(
    `${total} tests | ${passed} passed | ${failed} failed | ${passRate.toFixed(0)}% pass rate`,
  );
  lines.push(
    `Score: ${meanScore.toFixed(2)} | Duration: ${durationStr} | Tokens: ${totalTokens.toLocaleString()}`,
  );

  if (failedIds.length > 0) {
    lines.push('');
    lines.push(`Failed: ${failedIds.join(', ')}`);
  }

  return lines.join('\n');
}

export interface SummaryJson {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  meanScore: number;
  totalDurationMs: number;
  totalTokens: number;
  failedTestIds: string[];
}

export function formatSummaryJson(results: EvaluationResult[]): SummaryJson {
  const total = results.length;
  const passed = results.filter((r) => r.score >= 1.0).length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 1000) / 1000 : 0;
  const meanScore =
    total > 0
      ? Math.round((results.reduce((s, r) => s + r.score, 0) / total) * 1000) / 1000
      : 0;

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
    passRate,
    meanScore,
    totalDurationMs,
    totalTokens,
    failedTestIds,
  };
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsSummaryCommand = command({
  name: 'summary',
  description: 'Show compact pass/fail summary of eval results',
  args: {
    source: sourceArg,
    format: formatOption,
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, format, dir }) => {
    const cwd = dir ?? process.cwd();
    try {
      const { results } = await loadResults(source, cwd);
      const fmt = format ?? 'markdown';

      if (fmt === 'json') {
        console.log(JSON.stringify(formatSummaryJson(results), null, 2));
      } else {
        console.log(formatSummaryMarkdown(results));
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
