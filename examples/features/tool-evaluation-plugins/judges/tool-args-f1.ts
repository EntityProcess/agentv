#!/usr/bin/env bun
/**
 * Tool-Call + Arguments F1 Scoring Judge
 *
 * Extends tool-call-f1.ts by also validating tool arguments.
 * A tool call is a "hit" only if both the tool name matches AND the
 * required arguments are present with expected values.
 *
 * Configuration (via evaluator config in YAML):
 *   expected_tools:
 *     - tool: "search"
 *       args: { query: "weather tokyo" }    # required args (subset match)
 *     - tool: "fetch"                       # no args check — name-only match
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: tool-args-f1
 *       type: code_judge
 *       script: ["bun", "run", "../judges/tool-args-f1.ts"]
 *       expected_tools:
 *         - tool: search
 *           args: { query: "weather" }
 *         - tool: fetch
 */
import { type CodeJudgeInput, defineCodeJudge } from '@agentv/eval';

interface ExpectedTool {
  tool: string;
  args?: Record<string, unknown>;
}

interface ActualCall {
  tool: string;
  input: Record<string, unknown>;
}

function extractActualCalls(input: CodeJudgeInput): ActualCall[] {
  const calls: ActualCall[] = [];
  for (const msg of input.output ?? []) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        calls.push({
          tool: call.tool,
          input: (call.input as Record<string, unknown>) ?? {},
        });
      }
    }
  }
  return calls;
}

/** Check if actual args contain all expected key-value pairs (subset match). */
function argsMatch(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(expected)) {
    const actualVal = actual[key];
    if (typeof value === 'string' && typeof actualVal === 'string') {
      if (!actualVal.toLowerCase().includes(value.toLowerCase())) return false;
    } else if (JSON.stringify(actualVal) !== JSON.stringify(value)) {
      return false;
    }
  }
  return true;
}

export default defineCodeJudge(({ output, config, ...rest }) => {
  const rawExpected = config?.expected_tools;
  if (!rawExpected || !Array.isArray(rawExpected) || rawExpected.length === 0) {
    return {
      score: 0,
      misses: ['No expected_tools configured — provide an array of {tool, args?} objects'],
      reasoning: 'Cannot compute F1 without expected_tools.',
    };
  }

  const expectedTools: ExpectedTool[] = rawExpected.map((e: unknown) =>
    typeof e === 'string' ? { tool: e } : (e as ExpectedTool),
  );

  const input: CodeJudgeInput = { output, config, ...rest };
  const actualCalls = extractActualCalls(input);

  // Greedy matching: for each expected tool, find first unmatched actual call
  const usedActual = new Set<number>();
  const hits: string[] = [];
  const fn: string[] = [];

  for (const expected of expectedTools) {
    let matched = false;
    for (let i = 0; i < actualCalls.length; i++) {
      if (usedActual.has(i)) continue;
      const actual = actualCalls[i];
      if (actual.tool !== expected.tool) continue;
      if (expected.args && !argsMatch(expected.args, actual.input)) continue;
      usedActual.add(i);
      matched = true;
      const detail = expected.args
        ? `'${expected.tool}' called with matching args`
        : `'${expected.tool}' called`;
      hits.push(detail);
      break;
    }
    if (!matched) {
      const detail = expected.args
        ? `'${expected.tool}' not called with args ${JSON.stringify(expected.args)}`
        : `'${expected.tool}' not called`;
      fn.push(detail);
    }
  }

  // Unmatched actual calls are false positives
  const fpTools: string[] = [];
  for (let i = 0; i < actualCalls.length; i++) {
    if (!usedActual.has(i)) {
      fpTools.push(`Unexpected call to '${actualCalls[i].tool}'`);
    }
  }

  const tp = hits.length;
  const fpCount = fpTools.length;
  const fnCount = fn.length;

  const precision = tp + fpCount > 0 ? tp / (tp + fpCount) : 0;
  const recall = tp + fnCount > 0 ? tp / (tp + fnCount) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    score: Math.round(f1 * 1000) / 1000,
    hits,
    misses: [...fn, ...fpTools],
    reasoning: `precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} F1=${f1.toFixed(3)} | TP=${tp} FP=${fpCount} FN=${fnCount}`,
    details: { precision, recall, f1, tp, fp: fpCount, fn: fnCount },
  };
});
