#!/usr/bin/env bun
/**
 * Tool-Call F1 Scoring Grader
 *
 * Computes precision, recall, and F1 score by comparing expected tool calls
 * against actual tool calls from the agent's output messages.
 *
 * Configuration (via evaluator config in YAML):
 *   expected_tools: string[]  — list of tool names the agent should call
 *
 * Why this is a plugin (not built-in):
 * - F1 scoring over tool names is a composed metric (set comparison)
 * - Different projects may weight precision vs recall differently
 * - Easy to extend with argument matching (see tool-args-f1.ts)
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: tool-f1
 *       type: code_grader
 *       script: ["bun", "run", "../graders/tool-call-f1.ts"]
 *       expected_tools: ["search", "fetch"]
 */
import { type CodeGraderInput, defineCodeGrader } from '@agentv/eval';

function extractActualTools(input: CodeGraderInput): string[] {
  const tools: string[] = [];
  for (const msg of input.output ?? []) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        tools.push(call.tool);
      }
    }
  }
  return tools;
}

export default defineCodeGrader(({ output, config, ...rest }) => {
  const expectedTools: string[] =
    (config?.expectedTools as string[]) ?? (config?.expected_tools as string[]) ?? [];

  if (expectedTools.length === 0) {
    return {
      score: 0,
      assertions: [
        {
          text: 'No expected_tools configured — set expected_tools in evaluator config',
          passed: false,
        },
      ],
    };
  }

  const input: CodeGraderInput = { output, config, ...rest };
  const actualTools = extractActualTools(input);
  const actualSet = new Set(actualTools);

  // True positives: expected tools that were called
  const tp = expectedTools.filter((t) => actualSet.has(t));
  // False negatives: expected tools that were NOT called
  const fn = expectedTools.filter((t) => !actualSet.has(t));
  // False positives: called tools that were NOT expected
  const expectedSet = new Set(expectedTools);
  const fp = actualTools.filter((t) => !expectedSet.has(t));
  // Deduplicate FP list for reporting (but count all for precision)
  const fpUnique = [...new Set(fp)];

  const precision = tp.length + fp.length > 0 ? tp.length / (tp.length + fp.length) : 0;
  const recall = tp.length + fn.length > 0 ? tp.length / (tp.length + fn.length) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const assertions: Array<{ text: string; passed: boolean }> = [
    ...tp.map((t) => ({ text: `Expected tool '${t}' was called`, passed: true })),
    ...fn.map((t) => ({ text: `Expected tool '${t}' was NOT called`, passed: false })),
    ...fpUnique.map((t) => ({ text: `Unexpected tool '${t}' was called`, passed: false })),
  ];

  return {
    score: Math.round(f1 * 1000) / 1000,
    assertions,
    details: { precision, recall, f1, tp: tp.length, fp: fp.length, fn: fn.length },
  };
});
