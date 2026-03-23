/**
 * `agentv results failures` — show only failed tests with assertion evidence.
 *
 * Filters results to score < 1.0 and outputs JSON with each failed test's
 * failed assertions with evidence text. Passing tests are omitted entirely.
 *
 * How to extend:
 *   - To add new fields to failure output, update formatFailures and FailureEntry.
 */

import type { EvaluationResult } from '@agentv/core';
import { command, option, optional, string } from 'cmd-ts';
import { loadResults, sourceArg } from './shared.js';

// ── Formatting ───────────────────────────────────────────────────────────

export interface FailureEntry {
  test_id: string;
  score: number;
  assertions: { text: string; passed: boolean; evidence?: string }[];
}

export function formatFailures(results: EvaluationResult[]): FailureEntry[] {
  return results
    .filter((r) => r.score < 1.0)
    .map((r) => {
      let assertions = (r.assertions ?? []).map((a) => ({
        text: a.text,
        passed: a.passed,
        evidence: a.evidence,
      }));

      // Fall back to per-evaluator assertions
      if (assertions.length === 0 && r.scores) {
        assertions = r.scores.flatMap((s) =>
          (s.assertions ?? []).map((a) => ({
            text: a.text,
            passed: a.passed,
            evidence: a.evidence,
          })),
        );
      }

      return { test_id: r.testId, score: r.score, assertions };
    });
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsFailuresCommand = command({
  name: 'failures',
  description: 'Show only failed tests with assertion evidence',
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
      console.log(JSON.stringify(formatFailures(results), null, 2));
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
