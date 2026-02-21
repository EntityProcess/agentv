#!/usr/bin/env bun
/**
 * Levenshtein Distance Code Judge
 *
 * Computes normalised edit distance between candidate and reference text.
 * The score is 1 - (distance / maxLength), so identical strings score 1.0
 * and completely different strings score close to 0.
 */
import { defineCodeJudge } from '@agentv/eval';

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

export default defineCodeJudge(({ answer, referenceAnswer, expectedOutput }) => {
  const reference =
    referenceAnswer ??
    (expectedOutput[0] && typeof expectedOutput[0].content === 'string'
      ? expectedOutput[0].content
      : '');

  if (!reference) {
    return { score: 0, misses: ['No reference text provided'], reasoning: 'Missing reference.' };
  }

  const candNorm = answer.trim().toLowerCase();
  const refNorm = reference.trim().toLowerCase();

  const distance = levenshteinDistance(candNorm, refNorm);
  const maxLen = Math.max(candNorm.length, refNorm.length);
  const score = maxLen === 0 ? 1 : 1 - distance / maxLen;

  const hits: string[] = [];
  const misses: string[] = [];

  if (score >= 0.8) hits.push(`Edit similarity ${score.toFixed(3)} >= 0.8`);
  else misses.push(`Edit similarity ${score.toFixed(3)} < 0.8`);

  return {
    score,
    hits,
    misses,
    reasoning: `Levenshtein distance=${distance}, normalised similarity=${score.toFixed(3)}`,
    details: { distance, maxLen, similarity: score },
  };
});
