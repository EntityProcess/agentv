#!/usr/bin/env bun
/**
 * Efficiency Check - Code Judge for Execution Metrics
 *
 * Demonstrates how to evaluate agent efficiency using execution metrics
 * available in the metrics payload.
 */
import { defineCodeJudge } from '@agentv/eval';

// Configurable thresholds
const THRESHOLDS = {
  maxToolCalls: 5,
  maxTokens: 2000,
  maxCostUsd: 0.01,
  maxDurationMs: 10000,
};

export default defineCodeJudge(({ metrics }) => {
  const hits: string[] = [];
  const misses: string[] = [];
  const checks: boolean[] = [];

  if (!metrics) {
    return {
      score: 0.5,
      hits: [],
      misses: ['No metrics summary available'],
      reasoning: 'Cannot evaluate efficiency without metrics data',
    };
  }

  // Check tool call count
  if (metrics.eventCount <= THRESHOLDS.maxToolCalls) {
    hits.push(`Tool calls (${metrics.eventCount}) within limit (${THRESHOLDS.maxToolCalls})`);
    checks.push(true);
  } else {
    misses.push(`Too many tool calls: ${metrics.eventCount} (max: ${THRESHOLDS.maxToolCalls})`);
    checks.push(false);
  }

  // Check token usage if available
  if (metrics.tokenUsage) {
    const totalTokens = metrics.tokenUsage.input + metrics.tokenUsage.output;
    if (totalTokens <= THRESHOLDS.maxTokens) {
      hits.push(`Token usage (${totalTokens}) within limit`);
      checks.push(true);
    } else {
      misses.push(`High token usage: ${totalTokens} (max: ${THRESHOLDS.maxTokens})`);
      checks.push(false);
    }
  }

  // Check cost if available
  if (metrics.costUsd !== undefined) {
    if (metrics.costUsd <= THRESHOLDS.maxCostUsd) {
      hits.push(`Cost ($${metrics.costUsd.toFixed(4)}) within budget`);
      checks.push(true);
    } else {
      misses.push(`High cost: $${metrics.costUsd.toFixed(4)} (max: $${THRESHOLDS.maxCostUsd})`);
      checks.push(false);
    }
  }

  // Check duration if available
  if (metrics.durationMs !== undefined) {
    if (metrics.durationMs <= THRESHOLDS.maxDurationMs) {
      hits.push(`Duration (${metrics.durationMs}ms) within limit`);
      checks.push(true);
    } else {
      misses.push(`Slow execution: ${metrics.durationMs}ms (max: ${THRESHOLDS.maxDurationMs}ms)`);
      checks.push(false);
    }
  }

  // Calculate score
  const passCount = checks.filter((c) => c).length;
  const score = checks.length > 0 ? passCount / checks.length : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    hits: hits.slice(0, 4),
    misses: misses.slice(0, 4),
    reasoning: `Checked ${checks.length} efficiency metrics: ${passCount} passed, ${checks.length - passCount} failed`,
  };
});
