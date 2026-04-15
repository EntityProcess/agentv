#!/usr/bin/env bun
/**
 * Tool-Call + Arguments F1 Scoring Grader
 *
 * Extends tool-call-f1.ts by also validating tool arguments.
 * A tool call is a "hit" only if both the tool name matches AND the
 * required arguments are present with expected values.
 *
 * Configuration (via grader config in YAML):
 *   expected_tools:
 *     - tool: "search"
 *       args: { query: "weather tokyo" }    # required args (subset match)
 *     - tool: "fetch"                       # no args check — name-only match
 *
 * Usage in eval YAML:
 *   graders:
 *     - name: tool-args-f1
 *       type: code_grader
 *       script: ["bun", "run", "../graders/tool-args-f1.ts"]
 *       expected_tools:
 *         - tool: search
 *           args: { query: "weather" }
 *         - tool: fetch
 */
import { type CodeGraderInput, defineCodeGrader } from '@agentv/eval';

interface ExpectedTool {
  tool: string;
  args?: Record<string, unknown>;
}

interface ActualCall {
  tool: string;
  input: Record<string, unknown>;
}

function extractActualCalls(input: CodeGraderInput): ActualCall[] {
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

export default defineCodeGrader(({ output, config, ...rest }) => {
  const rawExpected = config?.expectedTools ?? config?.expected_tools;
  if (!rawExpected || !Array.isArray(rawExpected) || rawExpected.length === 0) {
    return {
      score: 0,
      assertions: [
        {
          text: 'No expected_tools configured — provide an array of {tool, args?} objects',
          passed: false,
        },
      ],
    };
  }

  const expectedTools: ExpectedTool[] = rawExpected.map((e: unknown) =>
    typeof e === 'string' ? { tool: e } : (e as ExpectedTool),
  );

  const input: CodeGraderInput = { output, config, ...rest };
  const actualCalls = extractActualCalls(input);

  // Greedy matching: for each expected tool, find first unmatched actual call
  const usedActual = new Set<number>();
  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];
  let fnCount = 0;

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
      assertions.push({ text: detail, passed: true });
      break;
    }
    if (!matched) {
      const detail = expected.args
        ? `'${expected.tool}' not called with args ${JSON.stringify(expected.args)}`
        : `'${expected.tool}' not called`;
      assertions.push({ text: detail, passed: false });
      fnCount++;
    }
  }

  // Unmatched actual calls are false positives
  let fpCount = 0;
  for (let i = 0; i < actualCalls.length; i++) {
    if (!usedActual.has(i)) {
      assertions.push({ text: `Unexpected call to '${actualCalls[i].tool}'`, passed: false });
      fpCount++;
    }
  }

  const tp = assertions.filter((a) => a.passed).length;

  const precision = tp + fpCount > 0 ? tp / (tp + fpCount) : 0;
  const recall = tp + fnCount > 0 ? tp / (tp + fnCount) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    score: Math.round(f1 * 1000) / 1000,
    assertions,
    details: { precision, recall, f1, tp, fp: fpCount, fn: fnCount },
  };
});
