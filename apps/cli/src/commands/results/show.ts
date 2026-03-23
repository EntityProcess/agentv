/**
 * `agentv results show` — full detail for a single test result.
 *
 * Displays JSON with input, score, duration, tokens, all assertions (pass + fail),
 * and the agent's response output for one test identified by --test-id.
 *
 * How to extend:
 *   - To add new detail fields, update formatShow and the ShowJson interface.
 */

import type { EvaluationResult } from '@agentv/core';
import { command, option, optional, string } from 'cmd-ts';
import { loadResults, sourceArg } from './shared.js';

// ── Helpers ──────────────────────────────────────────────────────────────

export function findResult(
  results: EvaluationResult[],
  testId: string,
): EvaluationResult | undefined {
  return results.find((r) => r.testId === testId);
}

function formatInput(result: EvaluationResult): string {
  const input = (result as unknown as Record<string, unknown>).input;
  if (!input) return '(no input)';
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input
      .map((msg: unknown) => String((msg as Record<string, unknown>).content ?? ''))
      .join('\n');
  }
  return '(no input)';
}

function formatOutput(result: EvaluationResult): string {
  if (!result.output || result.output.length === 0) return '(no output)';
  return result.output
    .map((msg) => String((msg as unknown as Record<string, unknown>).content ?? ''))
    .join('\n');
}

// ── Formatting ───────────────────────────────────────────────────────────

export interface ShowJson {
  test_id: string;
  score: number;
  duration_ms?: number;
  total_tokens?: number;
  input: string;
  assertions: { text: string; passed: boolean; evidence?: string }[];
  response: string;
}

export function formatShow(result: EvaluationResult): ShowJson {
  const usage = result.tokenUsage as { input?: number; output?: number } | undefined;
  let allAssertions = (result.assertions ?? []).map((a) => ({
    text: a.text,
    passed: a.passed,
    evidence: a.evidence,
  }));

  if (allAssertions.length === 0 && result.scores) {
    allAssertions = result.scores.flatMap((s) =>
      (s.assertions ?? []).map((a) => ({
        text: a.text,
        passed: a.passed,
        evidence: a.evidence,
      })),
    );
  }

  return {
    test_id: result.testId,
    score: result.score,
    duration_ms: result.durationMs,
    total_tokens: usage ? (usage.input ?? 0) + (usage.output ?? 0) : undefined,
    input: formatInput(result),
    assertions: allAssertions,
    response: formatOutput(result),
  };
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsShowCommand = command({
  name: 'show',
  description: 'Show full detail for a single test result',
  args: {
    source: sourceArg,
    testId: option({
      type: string,
      long: 'test-id',
      short: 't',
      description: 'Test ID to display',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, testId, dir }) => {
    const cwd = dir ?? process.cwd();
    try {
      const { results } = await loadResults(source, cwd);
      const result = findResult(results, testId);

      if (!result) {
        const available = results.map((r) => r.testId).join(', ');
        console.error(`Error: Test ID "${testId}" not found.`);
        console.error(`Available test IDs: ${available}`);
        process.exit(1);
      }

      console.log(JSON.stringify(formatShow(result), null, 2));
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
