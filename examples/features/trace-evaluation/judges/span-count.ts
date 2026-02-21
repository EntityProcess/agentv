#!/usr/bin/env bun
/**
 * Span Count Judge
 *
 * Validates that the number of LLM calls and tool executions stays
 * within configurable thresholds using trace data.
 */
import { defineCodeJudge } from '@agentv/eval';

const DEFAULTS = {
  maxLlmCalls: 10,
  maxToolCalls: 15,
};

export default defineCodeJudge(({ trace, config }) => {
  if (!trace) {
    return {
      score: 0,
      misses: ['No trace available'],
      reasoning: 'Cannot evaluate span counts without trace data',
    };
  }

  const maxLlmCalls = (config?.maxLlmCalls as number) ?? DEFAULTS.maxLlmCalls;
  const maxToolCalls = (config?.maxToolCalls as number) ?? DEFAULTS.maxToolCalls;

  const hits: string[] = [];
  const misses: string[] = [];

  // Check LLM call count
  if (trace.llmCallCount !== undefined) {
    if (trace.llmCallCount <= maxLlmCalls) {
      hits.push(`LLM calls (${trace.llmCallCount}) within limit (${maxLlmCalls})`);
    } else {
      misses.push(`Too many LLM calls: ${trace.llmCallCount} (max: ${maxLlmCalls})`);
    }
  }

  // Check tool execution count
  if (trace.eventCount <= maxToolCalls) {
    hits.push(`Tool calls (${trace.eventCount}) within limit (${maxToolCalls})`);
  } else {
    misses.push(`Too many tool calls: ${trace.eventCount} (max: ${maxToolCalls})`);
  }

  const total = hits.length + misses.length;
  const score = total > 0 ? hits.length / total : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    hits,
    misses,
    reasoning: `Checked span counts: ${hits.length} passed, ${misses.length} failed`,
  };
});
