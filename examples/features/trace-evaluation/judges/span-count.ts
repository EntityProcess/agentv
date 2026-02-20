#!/usr/bin/env bun
/**
 * Span Count Judge
 *
 * Validates that the number of LLM calls and tool executions stays
 * within configurable thresholds using traceSummary data.
 */
import { defineCodeJudge } from '@agentv/eval';

const DEFAULTS = {
  maxLlmCalls: 10,
  maxToolCalls: 15,
};

export default defineCodeJudge(({ traceSummary, config }) => {
  if (!traceSummary) {
    return {
      score: 0,
      misses: ['No traceSummary available'],
      reasoning: 'Cannot evaluate span counts without trace data',
    };
  }

  const maxLlmCalls = (config?.maxLlmCalls as number) ?? DEFAULTS.maxLlmCalls;
  const maxToolCalls = (config?.maxToolCalls as number) ?? DEFAULTS.maxToolCalls;

  const hits: string[] = [];
  const misses: string[] = [];

  // Check LLM call count
  if (traceSummary.llmCallCount !== undefined) {
    if (traceSummary.llmCallCount <= maxLlmCalls) {
      hits.push(`LLM calls (${traceSummary.llmCallCount}) within limit (${maxLlmCalls})`);
    } else {
      misses.push(`Too many LLM calls: ${traceSummary.llmCallCount} (max: ${maxLlmCalls})`);
    }
  }

  // Check tool execution count
  if (traceSummary.eventCount <= maxToolCalls) {
    hits.push(`Tool calls (${traceSummary.eventCount}) within limit (${maxToolCalls})`);
  } else {
    misses.push(`Too many tool calls: ${traceSummary.eventCount} (max: ${maxToolCalls})`);
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
