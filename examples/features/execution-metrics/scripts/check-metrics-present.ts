#!/usr/bin/env bun
/**
 * Check Metrics Present - Code Grader Plugin
 *
 * Verifies that execution metrics are present in the trace payload.
 * This is a simple sanity check that metrics collection is working.
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: metrics-present
 *       type: code_grader
 *       script: ["bun", "run", "../scripts/check-metrics-present.ts"]
 */
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ trace, tokenUsage, costUsd, durationMs }) => {
  const assertions: Array<{ text: string; passed: boolean }> = [];

  if (!trace) {
    return {
      score: 0,
      assertions: [{ text: 'No trace provided', passed: false }],
    };
  }

  // Check for tokenUsage
  if (tokenUsage) {
    assertions.push({ text: `tokenUsage present: ${tokenUsage.input}/${tokenUsage.output}`, passed: true });
  } else {
    assertions.push({ text: 'tokenUsage not present', passed: false });
  }

  // Check for costUsd
  if (costUsd !== undefined) {
    assertions.push({ text: `costUsd present: $${costUsd.toFixed(4)}`, passed: true });
  } else {
    assertions.push({ text: 'costUsd not present', passed: false });
  }

  // Check for durationMs
  if (durationMs !== undefined) {
    assertions.push({ text: `durationMs present: ${durationMs}ms`, passed: true });
  } else {
    assertions.push({ text: 'durationMs not present', passed: false });
  }

  const passed = assertions.filter((a) => a.passed).length;
  const score = passed / assertions.length;

  return {
    score,
    assertions,
  };
});
