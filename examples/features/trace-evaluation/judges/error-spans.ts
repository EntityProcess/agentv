#!/usr/bin/env bun
/**
 * Error Spans Judge
 *
 * Detects errors in agent traces by inspecting metrics.errorCount
 * and optionally checking for specific tool failures.
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ metrics, config }) => {
  if (!metrics) {
    return {
      score: 0,
      misses: ['No metrics available'],
      reasoning: 'Cannot detect errors without metrics data',
    };
  }

  const maxErrors = (config?.maxErrors as number) ?? 0;
  const hits: string[] = [];
  const misses: string[] = [];

  // Check error count
  if (metrics.errorCount <= maxErrors) {
    hits.push(`Error count (${metrics.errorCount}) within limit (${maxErrors})`);
  } else {
    misses.push(`Too many errors: ${metrics.errorCount} (max: ${maxErrors})`);
  }

  // Check for tools that might indicate errors (if configured)
  const forbiddenTools = (config?.forbiddenTools as string[]) ?? [];
  for (const tool of forbiddenTools) {
    const count = metrics.toolCallsByName[tool];
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
      metrics.errorCount === 0
        ? 'No errors detected in trace'
        : `Found ${metrics.errorCount} error(s) in trace`,
  };
});
