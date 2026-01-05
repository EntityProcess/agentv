#!/usr/bin/env bun
/**
 * Check Metrics Present - Code Judge Plugin
 *
 * Verifies that execution metrics are present in the traceSummary payload.
 * This is a simple sanity check that metrics collection is working.
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: metrics-present
 *       type: code_judge
 *       script: ["bun", "run", "../scripts/check-metrics-present.ts"]
 */
import { defineCodeJudge } from '../../../../packages/core/dist/judge/index.js';

export default defineCodeJudge(({ traceSummary }) => {
  const hits: string[] = [];
  const misses: string[] = [];

  if (!traceSummary) {
    return {
      score: 0,
      hits: [],
      misses: ['No traceSummary provided'],
      reasoning: 'Execution metrics collection failed - no traceSummary',
    };
  }

  // Check for tokenUsage
  if (traceSummary.tokenUsage) {
    hits.push(
      `tokenUsage present: ${traceSummary.tokenUsage.input}/${traceSummary.tokenUsage.output}`,
    );
  } else {
    misses.push('tokenUsage not present');
  }

  // Check for costUsd
  if (traceSummary.costUsd !== undefined) {
    hits.push(`costUsd present: $${traceSummary.costUsd.toFixed(4)}`);
  } else {
    misses.push('costUsd not present');
  }

  // Check for durationMs
  if (traceSummary.durationMs !== undefined) {
    hits.push(`durationMs present: ${traceSummary.durationMs}ms`);
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
