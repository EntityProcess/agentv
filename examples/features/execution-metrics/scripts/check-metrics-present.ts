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
  const hits: string[] = [];
  const misses: string[] = [];

  if (!trace) {
    return {
      score: 0,
      hits: [],
      misses: ['No trace provided'],
      reasoning: 'Execution metrics collection failed - no trace',
    };
  }

  // Check for tokenUsage
  if (tokenUsage) {
    hits.push(`tokenUsage present: ${tokenUsage.input}/${tokenUsage.output}`);
  } else {
    misses.push('tokenUsage not present');
  }

  // Check for costUsd
  if (costUsd !== undefined) {
    hits.push(`costUsd present: $${costUsd.toFixed(4)}`);
  } else {
    misses.push('costUsd not present');
  }

  // Check for durationMs
  if (durationMs !== undefined) {
    hits.push(`durationMs present: ${durationMs}ms`);
  } else {
    misses.push('durationMs not present');
  }

  const score = hits.length / (hits.length + misses.length);

  return {
    score,
    hits,
    misses,
    reasoning: `Checked 3 metric fields: ${hits.length} present, ${misses.length} missing`,
  };
});
