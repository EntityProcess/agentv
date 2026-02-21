#!/usr/bin/env bun
/**
 * Tool-Call F1 Scoring Judge
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
 *       type: code_judge
 *       script: ["bun", "run", "../judges/tool-call-f1.ts"]
 *       expected_tools: ["search", "fetch"]
 */
import { type CodeJudgeInput, defineCodeJudge } from '@agentv/eval';

function extractActualTools(input: CodeJudgeInput): string[] {
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

export default defineCodeJudge(({ output, config, ...rest }) => {
  const expectedTools: string[] = (config?.expected_tools as string[]) ?? [];

  if (expectedTools.length === 0) {
    return {
      score: 0,
      misses: ['No expected_tools configured — set expected_tools in evaluator config'],
      reasoning: 'Cannot compute F1 without expected_tools.',
    };
  }

  const input: CodeJudgeInput = { output, config, ...rest };
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

  const hits: string[] = tp.map((t) => `Expected tool '${t}' was called`);
  const misses: string[] = [
    ...fn.map((t) => `Expected tool '${t}' was NOT called`),
    ...fpUnique.map((t) => `Unexpected tool '${t}' was called`),
  ];

  return {
    score: Math.round(f1 * 1000) / 1000,
    hits,
    misses,
    reasoning: `precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} F1=${f1.toFixed(3)} | expected=${expectedTools.length} actual=${actualTools.length} TP=${tp.length} FP=${fp.length} FN=${fn.length}`,
    details: { precision, recall, f1, tp: tp.length, fp: fp.length, fn: fn.length },
  };
});
