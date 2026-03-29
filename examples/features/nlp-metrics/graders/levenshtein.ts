#!/usr/bin/env bun
/**
 * Levenshtein Distance Code Grader
 *
 * Computes normalised edit distance between candidate and reference text.
 * The score is 1 - (distance / maxLength), so identical strings score 1.0
 * and completely different strings score close to 0.
 */
import { defineCodeGrader } from '@agentv/eval';

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use two-row optimisation for memory efficiency
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n] ?? 0;
}

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

export default defineCodeGrader(({ output, expectedOutput }) => {
  const outputText = getMessageText(output ?? []);
  const reference = getMessageText(expectedOutput);

  if (!reference) {
    return {
      score: 0,
      assertions: [{ text: 'No reference text provided', passed: false }],
    };
  }

  const candNorm = outputText.trim().toLowerCase();
  const refNorm = reference.trim().toLowerCase();

  const distance = levenshteinDistance(candNorm, refNorm);
  const maxLen = Math.max(candNorm.length, refNorm.length);
  const score = maxLen === 0 ? 1 : 1 - distance / maxLen;

  const passed = score >= 0.8;
  const assertions = [
    {
      text: passed
        ? `Edit similarity ${score.toFixed(3)} >= 0.8`
        : `Edit similarity ${score.toFixed(3)} < 0.8`,
      passed,
      evidence: `Levenshtein distance=${distance}, normalised similarity=${score.toFixed(3)}`,
    },
  ];

  return {
    score,
    assertions,
    details: { distance, maxLen, similarity: score },
  };
});
