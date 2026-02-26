#!/usr/bin/env bun
/**
 * Check Metrics Present - Code Judge Plugin
 *
 * Verifies that execution metrics are present in the metrics payload.
 * This is a simple sanity check that metrics collection is working.
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: metrics-present
 *       type: code_judge
 *       script: ["bun", "run", "../scripts/check-metrics-present.ts"]
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ metrics }) => {
  const hits: string[] = [];
  const misses: string[] = [];

  if (!metrics) {
    return {
      score: 0,
      hits: [],
      misses: ['No metrics provided'],
      reasoning: 'Execution metrics collection failed - no metrics',
    };
  }

  // Check for tokenUsage
  if (metrics.tokenUsage) {
    hits.push(`tokenUsage present: ${metrics.tokenUsage.input}/${metrics.tokenUsage.output}`);
  } else {
    misses.push('tokenUsage not present');
  }

  // Check for costUsd
  if (metrics.costUsd !== undefined) {
    hits.push(`costUsd present: $${metrics.costUsd.toFixed(4)}`);
  } else {
    misses.push('costUsd not present');
  }

  // Check for durationMs
  if (metrics.durationMs !== undefined) {
    hits.push(`durationMs present: ${metrics.durationMs}ms`);
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
