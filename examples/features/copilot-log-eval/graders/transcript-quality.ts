#!/usr/bin/env bun
/**
 * Transcript Quality Grader
 *
 * Validates that the copilot-log provider produced a meaningful transcript:
 * 1. At least one assistant message exists
 * 2. At least one tool call was recorded
 * 3. The assistant response addresses the user's question (mentions CSV-relevant terms)
 *
 * Uses the full Message[] from the copilot-log provider, including toolCalls arrays.
 *
 * Usage in eval YAML:
 *   assertions:
 *     - name: transcript-quality
 *       type: code-grader
 *       command: ["bun", "run", "../graders/transcript-quality.ts"]
 */
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ output, outputText }) => {
  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  // Check 1: At least one assistant message
  const assistantMessages = (output ?? []).filter((m) => m.role === 'assistant');
  if (assistantMessages.length > 0) {
    assertions.push({
      text: 'Transcript contains assistant messages',
      passed: true,
      evidence: `Found ${assistantMessages.length} assistant message(s)`,
    });
  } else {
    assertions.push({
      text: 'Transcript contains assistant messages',
      passed: false,
      evidence: 'No assistant messages found in transcript',
    });
  }

  // Check 2: At least one tool call was recorded
  const allToolCalls = assistantMessages.flatMap((m) => m.toolCalls ?? []);
  if (allToolCalls.length > 0) {
    const toolNames = [...new Set(allToolCalls.map((tc) => tc.tool).filter(Boolean))];
    assertions.push({
      text: 'Transcript contains tool calls',
      passed: true,
      evidence: `Found ${allToolCalls.length} tool call(s): ${toolNames.join(', ')}`,
    });
  } else {
    assertions.push({
      text: 'Transcript contains tool calls',
      passed: false,
      evidence: 'No tool calls found in transcript',
    });
  }

  // Check 3: Response addresses the CSV question
  const text = outputText.toLowerCase();
  const csvTerms = ['revenue', 'month', 'csv', 'sales', 'top'];
  const found = csvTerms.filter((term) => text.includes(term));
  if (found.length >= 2) {
    assertions.push({
      text: 'Response addresses the CSV analysis question',
      passed: true,
      evidence: `Found relevant terms: ${found.join(', ')}`,
    });
  } else {
    assertions.push({
      text: 'Response addresses the CSV analysis question',
      passed: false,
      evidence: `Only found ${found.length} relevant term(s): ${found.join(', ') || 'none'}`,
    });
  }

  const passed = assertions.filter((a) => a.passed).length;
  const score = assertions.length > 0 ? passed / assertions.length : 0;

  return { score, assertions };
});
