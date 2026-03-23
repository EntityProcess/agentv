/**
 * `agentv results failures` — show only failed tests with assertion evidence.
 *
 * Filters results to score < 1.0 and displays each failed test's
 * failed assertions with evidence text. Passing tests are omitted entirely.
 *
 * Supports --format json for programmatic use.
 *
 * How to extend:
 *   - To add new fields to failure output, update both formatFailuresMarkdown and formatFailuresJson.
 */

import type { EvaluationResult } from '@agentv/core';
import { command, option, optional, string } from 'cmd-ts';
import { formatOption, loadResults, sourceArg } from './shared.js';

// ── Formatting ───────────────────────────────────────────────────────────

export function formatFailuresMarkdown(results: EvaluationResult[]): string {
  const failed = results.filter((r) => r.score < 1.0);

  if (failed.length === 0) {
    return 'All tests passed.';
  }

  const sections: string[] = [];

  for (const r of failed) {
    const lines: string[] = [];
    lines.push(`## ${r.testId} (score: ${r.score.toFixed(1)})`);

    const assertions = r.assertions ?? [];
    for (const a of assertions) {
      const tag = a.passed ? 'PASS' : 'FAIL';
      let line = `- ${tag}: ${a.text}`;
      if (a.evidence) line += ` — ${a.evidence}`;
      lines.push(line);
    }

    // Also show per-evaluator assertions if top-level assertions are empty
    if (assertions.length === 0 && r.scores) {
      for (const s of r.scores) {
        if (s.assertions) {
          for (const a of s.assertions) {
            const tag = a.passed ? 'PASS' : 'FAIL';
            let line = `- ${tag}: ${a.text}`;
            if (a.evidence) line += ` — ${a.evidence}`;
            lines.push(line);
          }
        }
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

export interface FailureEntry {
  testId: string;
  score: number;
  assertions: { text: string; passed: boolean; evidence?: string }[];
}

export function formatFailuresJson(results: EvaluationResult[]): FailureEntry[] {
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

      return { testId: r.testId, score: r.score, assertions };
    });
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsFailuresCommand = command({
  name: 'failures',
  description: 'Show only failed tests with assertion evidence',
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
        console.log(JSON.stringify(formatFailuresJson(results), null, 2));
      } else {
        console.log(formatFailuresMarkdown(results));
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
