#!/usr/bin/env bun
/**
 * Efficiency Check - Code Grader for Execution Metrics
 *
 * Demonstrates how to evaluate agent efficiency using execution metrics
 * available in the trace payload.
 */
import { defineCodeGrader } from '@agentv/eval';

// Configurable thresholds
const THRESHOLDS = {
  maxToolCalls: 5,
  maxTokens: 2000,
  maxCostUsd: 0.01,
  maxDurationMs: 10000,
};

export default defineCodeGrader(({ trace, tokenUsage, costUsd, durationMs }) => {
  const assertions: Array<{ text: string; passed: boolean }> = [];

  if (!trace) {
    return {
      score: 0.5,
      assertions: [{ text: 'No trace summary available', passed: false }],
    };
  }

  // Check tool call count
  if (trace.eventCount <= THRESHOLDS.maxToolCalls) {
    assertions.push({
      text: `Tool calls (${trace.eventCount}) within limit (${THRESHOLDS.maxToolCalls})`,
      passed: true,
    });
  } else {
    assertions.push({
      text: `Too many tool calls: ${trace.eventCount} (max: ${THRESHOLDS.maxToolCalls})`,
      passed: false,
    });
  }

  // Check token usage if available
  if (tokenUsage) {
    const totalTokens = tokenUsage.input + tokenUsage.output;
    if (totalTokens <= THRESHOLDS.maxTokens) {
      assertions.push({ text: `Token usage (${totalTokens}) within limit`, passed: true });
    } else {
      assertions.push({
        text: `High token usage: ${totalTokens} (max: ${THRESHOLDS.maxTokens})`,
        passed: false,
      });
    }
  }

  // Check cost if available
  if (costUsd !== undefined) {
    if (costUsd <= THRESHOLDS.maxCostUsd) {
      assertions.push({ text: `Cost ($${costUsd.toFixed(4)}) within budget`, passed: true });
    } else {
      assertions.push({
        text: `High cost: $${costUsd.toFixed(4)} (max: $${THRESHOLDS.maxCostUsd})`,
        passed: false,
      });
    }
  }

  // Check duration if available
  if (durationMs !== undefined) {
    if (durationMs <= THRESHOLDS.maxDurationMs) {
      assertions.push({ text: `Duration (${durationMs}ms) within limit`, passed: true });
    } else {
      assertions.push({
        text: `Slow execution: ${durationMs}ms (max: ${THRESHOLDS.maxDurationMs}ms)`,
        passed: false,
      });
    }
  }

  // Calculate score
  const passCount = assertions.filter((a) => a.passed).length;
  const score = assertions.length > 0 ? passCount / assertions.length : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    assertions: assertions.slice(0, 8),
  };
});
