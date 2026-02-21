#!/usr/bin/env bun
/**
 * Error Spans Judge
 *
 * Detects errors in agent traces by inspecting trace.errorCount
 * and optionally checking for specific tool failures.
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ trace, config }) => {
  if (!trace) {
    return {
      score: 0,
      misses: ['No trace available'],
      reasoning: 'Cannot detect errors without trace data',
    };
  }

  const maxErrors = (config?.maxErrors as number) ?? 0;
  const hits: string[] = [];
  const misses: string[] = [];

  // Check error count
  if (trace.errorCount <= maxErrors) {
    hits.push(`Error count (${trace.errorCount}) within limit (${maxErrors})`);
  } else {
    misses.push(`Too many errors: ${trace.errorCount} (max: ${maxErrors})`);
  }

  // Check for tools that might indicate errors (if configured)
  const forbiddenTools = (config?.forbiddenTools as string[]) ?? [];
  for (const tool of forbiddenTools) {
    const count = trace.toolCallsByName[tool];
    if (count !== undefined && count > 0) {
      misses.push(`Forbidden tool "${tool}" was called ${count} time(s)`);
    } else {
      hits.push(`Forbidden tool "${tool}" was not called`);
    }
  }

  const total = hits.length + misses.length;
  const score = total > 0 ? hits.length / total : 1.0;

  return {
    score: Math.round(score * 100) / 100,
    hits,
    misses,
    reasoning:
      trace.errorCount === 0
        ? 'No errors detected in trace'
        : `Found ${trace.errorCount} error(s) in trace`,
  };
});
