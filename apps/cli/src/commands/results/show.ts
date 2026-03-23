/**
 * `agentv results show` — full detail for a single test result.
 *
 * Displays input, score, duration, tokens, all assertions (pass + fail),
 * and the agent's response output for one test identified by --test-id.
 *
 * Supports --format json for programmatic use.
 *
 * How to extend:
 *   - To add new detail fields, update both formatShowMarkdown and formatShowJson.
 */

import { command, option, optional, string } from 'cmd-ts';
import type { EvaluationResult } from '@agentv/core';
import { formatOption, loadResults, sourceArg } from './shared.js';

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
    return input.map((msg: any) => String(msg.content ?? '')).join('\n');
  }
  return '(no input)';
}

function formatOutput(result: EvaluationResult): string {
  if (!result.output || result.output.length === 0) return '(no output)';
  return result.output.map((msg) => String((msg as any).content ?? '')).join('\n');
}

// ── Formatting ───────────────────────────────────────────────────────────

export function formatShowMarkdown(result: EvaluationResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`## ${result.testId}`);

  // Input
  lines.push(`Input: ${formatInput(result)}`);

  // Metrics line
  const parts: string[] = [`Score: ${result.score}`];
  if (result.durationMs != null) {
    const dur =
      result.durationMs < 1000
        ? `${Math.round(result.durationMs)}ms`
        : `${(result.durationMs / 1000).toFixed(1)}s`;
    parts.push(`Duration: ${dur}`);
  }
  const usage = result.tokenUsage as { input?: number; output?: number } | undefined;
  if (usage) {
    parts.push(`Tokens: ${((usage.input ?? 0) + (usage.output ?? 0)).toLocaleString()}`);
  }
  lines.push(parts.join(' | '));

  // Assertions
  const assertions = result.assertions ?? [];
  const passedCount = assertions.filter((a) => a.passed).length;
  lines.push('');
  lines.push(`### Assertions (${passedCount}/${assertions.length} passed)`);
  for (const a of assertions) {
    const tag = a.passed ? 'PASS' : 'FAIL';
    let line = `- ${tag}: ${a.text}`;
    if (a.evidence) line += `\n  Evidence: ${a.evidence}`;
    lines.push(line);
  }

  // Also show per-evaluator assertions if top-level is empty
  if (assertions.length === 0 && result.scores) {
    for (const s of result.scores) {
      if (s.assertions && s.assertions.length > 0) {
        lines.push(`### ${s.name} (${s.type}, score: ${s.score})`);
        for (const a of s.assertions) {
          const tag = a.passed ? 'PASS' : 'FAIL';
          let line = `- ${tag}: ${a.text}`;
          if (a.evidence) line += `\n  Evidence: ${a.evidence}`;
          lines.push(line);
        }
      }
    }
  }

  // Response
  lines.push('');
  lines.push('### Response');
  lines.push(formatOutput(result));

  return lines.join('\n');
}

export interface ShowJson {
  testId: string;
  score: number;
  durationMs?: number;
  totalTokens?: number;
  input: string;
  assertions: { text: string; passed: boolean; evidence?: string }[];
  response: string;
}

export function formatShowJson(result: EvaluationResult): ShowJson {
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
    testId: result.testId,
    score: result.score,
    durationMs: result.durationMs,
    totalTokens: usage ? (usage.input ?? 0) + (usage.output ?? 0) : undefined,
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
    format: formatOption,
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, testId, format, dir }) => {
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

      const fmt = format ?? 'markdown';

      if (fmt === 'json') {
        console.log(JSON.stringify(formatShowJson(result), null, 2));
      } else {
        console.log(formatShowMarkdown(result));
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
