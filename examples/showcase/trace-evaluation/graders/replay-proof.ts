#!/usr/bin/env bun
import { appendFileSync } from 'node:fs';
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ trace, tokenUsage, costUsd, durationMs, output, config }) => {
  const proofLog = process.env.AGENTV_TRACE_SHOWCASE_PROOF_LOG;
  const testId = (process.env.AGENTV_EVAL_TEST_ID ?? process.env.AGENTV_TEST_ID) || 'unknown';
  const nestedConfig = config?.config as Record<string, unknown> | undefined;
  const requireMetrics =
    (config?.requireMetrics as boolean | undefined) ??
    (config?.require_metrics as boolean | undefined) ??
    (nestedConfig?.requireMetrics as boolean | undefined) ??
    (nestedConfig?.require_metrics as boolean | undefined) ??
    true;

  if (proofLog) {
    appendFileSync(
      proofLog,
      `${JSON.stringify({
        kind: 'grader_run',
        grader: 'replay-proof',
        test_id: testId,
        event_count: trace?.eventCount ?? 0,
        llm_call_count: trace?.llmCallCount ?? 0,
        token_usage_present: tokenUsage !== null && tokenUsage !== undefined,
        cost_usd_present: costUsd !== null && costUsd !== undefined,
        duration_ms_present: durationMs !== null && durationMs !== undefined,
      })}\n`,
      'utf8',
    );
  }

  const assistantMessages = output?.filter((message) => message.role === 'assistant') ?? [];
  const assertions = [
    {
      text: `Trace has tool calls (${trace?.eventCount ?? 0})`,
      passed: (trace?.eventCount ?? 0) > 0,
    },
    {
      text: `Trace has assistant model turns (${trace?.llmCallCount ?? 0})`,
      passed: (trace?.llmCallCount ?? 0) > 0,
    },
    {
      text: 'Provider metrics are present on replayed output',
      passed:
        !requireMetrics ||
        (tokenUsage !== null &&
          tokenUsage !== undefined &&
          costUsd !== null &&
          costUsd !== undefined &&
          durationMs !== null &&
          durationMs !== undefined),
    },
    {
      text: `Assistant messages available (${assistantMessages.length})`,
      passed: assistantMessages.length > 0,
    },
  ];

  const passed = assertions.filter((assertion) => assertion.passed).length;
  return {
    score: passed / assertions.length,
    assertions,
  };
});
