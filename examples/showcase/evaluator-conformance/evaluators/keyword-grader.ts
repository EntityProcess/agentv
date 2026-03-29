#!/usr/bin/env bun
/**
 * Sample evaluator for conformance testing.
 *
 * Deterministic keyword-matching grader: checks whether expected keywords
 * appear in the candidate output. Produces stable scores for unambiguous
 * cases and variable scores for partial matches.
 */
import { defineCodeGrader } from '@agentv/eval';

function getMessageText(
  messages: readonly { role: string; content?: unknown }[],
  role = 'assistant',
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === role) {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((b: { type?: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text)
          .join('\n');
      }
    }
  }
  return '';
}

export default defineCodeGrader(({ output, expectedOutput, criteria }) => {
  const outputText = getMessageText(output ?? []);
  const expectedOutputText = getMessageText(expectedOutput);
  const candidate = (outputText ?? '').toLowerCase().trim();
  const expected = (expectedOutputText ?? '').toLowerCase().trim();

  if (!candidate) {
    return {
      score: 0,
      assertions: [{ text: 'Empty candidate output', passed: false }],
    };
  }

  // Extract keywords from expected output (split on commas, spaces, punctuation)
  const keywords = expected.split(/[\s,.:;!?]+/).filter((w) => w.length > 1);

  if (keywords.length === 0) {
    return {
      score: 0.5,
      assertions: [],
    };
  }

  const assertions: Array<{ text: string; passed: boolean }> = [];

  for (const kw of keywords) {
    if (candidate.includes(kw)) {
      assertions.push({ text: `Contains "${kw}"`, passed: true });
    } else {
      assertions.push({ text: `Missing "${kw}"`, passed: false });
    }
  }

  const matched = assertions.filter((a) => a.passed).length;
  const score = matched / keywords.length;

  return {
    score: Math.round(score * 100) / 100,
    assertions,
  };
});
