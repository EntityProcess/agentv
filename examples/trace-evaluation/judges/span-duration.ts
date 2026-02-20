#!/usr/bin/env bun
/**
 * Span Duration Judge
 *
 * Validates that no individual tool execution exceeds a time threshold
 * using traceSummary.toolDurations data.
 */
import { defineCodeJudge } from '@agentv/eval';

const DEFAULT_MAX_SPAN_MS = 5000;

export default defineCodeJudge(({ traceSummary, config }) => {
  if (!traceSummary) {
    return {
      score: 0,
      misses: ['No traceSummary available'],
      reasoning: 'Cannot evaluate durations without trace data',
    };
  }

  const maxSpanMs = (config?.maxSpanMs as number) ?? DEFAULT_MAX_SPAN_MS;
  const hits: string[] = [];
  const misses: string[] = [];

  // Check overall duration
  if (traceSummary.durationMs !== undefined) {
    const maxTotalMs = (config?.maxTotalMs as number) ?? maxSpanMs * 5;
    if (traceSummary.durationMs <= maxTotalMs) {
      hits.push(`Total duration (${traceSummary.durationMs}ms) within limit (${maxTotalMs}ms)`);
    } else {
      misses.push(`Total duration too long: ${traceSummary.durationMs}ms (max: ${maxTotalMs}ms)`);
    }
  }

  // Check individual tool durations
  if (traceSummary.toolDurations) {
    for (const [tool, durations] of Object.entries(traceSummary.toolDurations)) {
      for (const duration of durations) {
        if (duration <= maxSpanMs) {
          hits.push(`${tool} (${duration}ms) within limit`);
        } else {
          misses.push(`${tool} too slow: ${duration}ms (max: ${maxSpanMs}ms)`);
        }
      }
    }
  }

  const total = hits.length + misses.length;
  const score = total > 0 ? hits.length / total : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    hits: hits.slice(0, 5),
    misses: misses.slice(0, 5),
    reasoning: `Checked durations against ${maxSpanMs}ms threshold: ${hits.length} passed, ${misses.length} failed`,
  };
});
