#!/usr/bin/env bun
/**
 * Check Metrics Present - Code Judge Plugin
 *
 * Verifies that execution metrics are present in the trace payload.
 * This is a simple sanity check that metrics collection is working.
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: metrics-present
 *       type: code_judge
 *       script: ["bun", "run", "../scripts/check-metrics-present.ts"]
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ trace }) => {
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
  if (trace.tokenUsage) {
    hits.push(
      `tokenUsage present: ${trace.tokenUsage.input}/${trace.tokenUsage.output}`,
    );
  } else {
    misses.push('tokenUsage not present');
  }

  // Check for costUsd
  if (trace.costUsd !== undefined) {
    hits.push(`costUsd present: $${trace.costUsd.toFixed(4)}`);
  } else {
    misses.push('costUsd not present');
  }

  // Check for durationMs
  if (trace.durationMs !== undefined) {
    hits.push(`durationMs present: ${trace.durationMs}ms`);
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
