#!/usr/bin/env bun
/**
 * Span Duration Grader
 *
 * Validates that no individual tool execution exceeds a time threshold
 * using trace.toolDurations data.
 */
import { defineCodeGrader } from '@agentv/eval';

const DEFAULT_MAX_SPAN_MS = 5000;

export default defineCodeGrader(({ trace, config, durationMs }) => {
  if (!trace) {
    return {
      score: 0,
      misses: ['No trace available'],
      reasoning: 'Cannot evaluate durations without trace data',
    };
  }

  const maxSpanMs = (config?.maxSpanMs as number) ?? DEFAULT_MAX_SPAN_MS;
  const hits: string[] = [];
  const misses: string[] = [];

  // Check overall duration
  if (durationMs !== undefined) {
    const maxTotalMs = (config?.maxTotalMs as number) ?? maxSpanMs * 5;
    if (durationMs <= maxTotalMs) {
      hits.push(`Total duration (${durationMs}ms) within limit (${maxTotalMs}ms)`);
    } else {
      misses.push(`Total duration too long: ${durationMs}ms (max: ${maxTotalMs}ms)`);
    }
  }

  // Check individual tool durations
  if (trace.toolDurations) {
    for (const [tool, durations] of Object.entries(trace.toolDurations)) {
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
