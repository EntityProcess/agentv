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
      assertions: [{ text: 'No trace available', passed: false }],
    };
  }

  const maxSpanMs = (config?.maxSpanMs as number) ?? DEFAULT_MAX_SPAN_MS;
  const assertions: Array<{ text: string; passed: boolean }> = [];

  // Check overall duration
  if (durationMs !== undefined) {
    const maxTotalMs = (config?.maxTotalMs as number) ?? maxSpanMs * 5;
    if (durationMs <= maxTotalMs) {
      assertions.push({
        text: `Total duration (${durationMs}ms) within limit (${maxTotalMs}ms)`,
        passed: true,
      });
    } else {
      assertions.push({
        text: `Total duration too long: ${durationMs}ms (max: ${maxTotalMs}ms)`,
        passed: false,
      });
    }
  }

  // Check individual tool durations
  if (trace.toolDurations) {
    for (const [tool, durations] of Object.entries(trace.toolDurations)) {
      for (const duration of durations) {
        if (duration <= maxSpanMs) {
          assertions.push({ text: `${tool} (${duration}ms) within limit`, passed: true });
        } else {
          assertions.push({
            text: `${tool} too slow: ${duration}ms (max: ${maxSpanMs}ms)`,
            passed: false,
          });
        }
      }
    }
  }

  const passed = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  const score = total > 0 ? passed / total : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    assertions: assertions.slice(0, 10),
  };
});
