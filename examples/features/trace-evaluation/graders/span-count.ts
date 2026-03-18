#!/usr/bin/env bun
/**
 * Span Count Grader
 *
 * Validates that the number of LLM calls and tool executions stays
 * within configurable thresholds using trace data.
 */
import { defineCodeGrader } from '@agentv/eval';

const DEFAULTS = {
  maxLlmCalls: 10,
  maxToolCalls: 15,
};

export default defineCodeGrader(({ trace, config }) => {
  if (!trace) {
    return {
      score: 0,
      assertions: [{ text: 'No trace available', passed: false }],
    };
  }

  const maxLlmCalls = (config?.maxLlmCalls as number) ?? DEFAULTS.maxLlmCalls;
  const maxToolCalls = (config?.maxToolCalls as number) ?? DEFAULTS.maxToolCalls;

  const assertions: Array<{ text: string; passed: boolean }> = [];

  // Check LLM call count
  if (trace.llmCallCount !== undefined) {
    if (trace.llmCallCount <= maxLlmCalls) {
      assertions.push({
        text: `LLM calls (${trace.llmCallCount}) within limit (${maxLlmCalls})`,
        passed: true,
      });
    } else {
      assertions.push({
        text: `Too many LLM calls: ${trace.llmCallCount} (max: ${maxLlmCalls})`,
        passed: false,
      });
    }
  }

  // Check tool execution count
  if (trace.eventCount <= maxToolCalls) {
    assertions.push({
      text: `Tool calls (${trace.eventCount}) within limit (${maxToolCalls})`,
      passed: true,
    });
  } else {
    assertions.push({
      text: `Too many tool calls: ${trace.eventCount} (max: ${maxToolCalls})`,
      passed: false,
    });
  }

  const passed = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  const score = total > 0 ? passed / total : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    assertions,
  };
});
