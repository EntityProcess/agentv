#!/usr/bin/env bun
/**
 * Error Spans Grader
 *
 * Detects errors in agent traces by inspecting trace.errorCount
 * and optionally checking for specific tool failures.
 */
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ trace, config }) => {
  if (!trace) {
    return {
      score: 0,
      assertions: [{ text: 'No trace available', passed: false }],
    };
  }

  const maxErrors = (config?.maxErrors as number) ?? 0;
  const assertions: Array<{ text: string; passed: boolean }> = [];

  // Check error count
  if (trace.errorCount <= maxErrors) {
    assertions.push({
      text: `Error count (${trace.errorCount}) within limit (${maxErrors})`,
      passed: true,
    });
  } else {
    assertions.push({
      text: `Too many errors: ${trace.errorCount} (max: ${maxErrors})`,
      passed: false,
    });
  }

  // Check for tools that might indicate errors (if configured)
  const forbiddenTools = (config?.forbiddenTools as string[]) ?? [];
  for (const tool of forbiddenTools) {
    const count = trace.toolCalls[tool];
    if (count !== undefined && count > 0) {
      assertions.push({
        text: `Forbidden tool "${tool}" was called ${count} time(s)`,
        passed: false,
      });
    } else {
      assertions.push({ text: `Forbidden tool "${tool}" was not called`, passed: true });
    }
  }

  const passed = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  const score = total > 0 ? passed / total : 1.0;

  return {
    score: Math.round(score * 100) / 100,
    assertions,
  };
});
