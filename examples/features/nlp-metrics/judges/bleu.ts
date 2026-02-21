#!/usr/bin/env bun
/**
 * BLEU Code Judge
 *
 * Computes a BLEU-like score between candidate and reference text.
 * BLEU (Bilingual Evaluation Understudy) measures n-gram precision with a
 * brevity penalty, commonly used for translation evaluation.
 */
import { defineCodeJudge } from '@agentv/eval';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function ngramCounts(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join(' ');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function clippedPrecision(candidate: string[], reference: string[], n: number): number {
  const candGrams = ngramCounts(candidate, n);
  const refGrams = ngramCounts(reference, n);

  let clipped = 0;
  let total = 0;

  for (const [gram, count] of candGrams) {
    const refCount = refGrams.get(gram) ?? 0;
    clipped += Math.min(count, refCount);
    total += count;
  }

  return total === 0 ? 0 : clipped / total;
}

function bleuScore(candidate: string, reference: string, maxN = 4): number {
  const candTokens = tokenize(candidate);
  const refTokens = tokenize(reference);

  if (candTokens.length === 0) return 0;

  // Brevity penalty
  const bp =
    candTokens.length >= refTokens.length ? 1 : Math.exp(1 - refTokens.length / candTokens.length);

  const effectiveN = Math.min(maxN, candTokens.length);
  let logSum = 0;
  let count = 0;

  for (let n = 1; n <= effectiveN; n++) {
    const p = clippedPrecision(candTokens, refTokens, n);
    if (p === 0) return 0; // If any n-gram precision is 0, BLEU is 0
    logSum += Math.log(p);
    count++;
  }

  return bp * Math.exp(logSum / count);
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

  const score = bleuScore(answer, reference);

  const hits: string[] = [];
  const misses: string[] = [];

  if (score >= 0.3) hits.push(`BLEU ${score.toFixed(3)} >= 0.3`);
  else misses.push(`BLEU ${score.toFixed(3)} < 0.3`);

  return {
    score,
    hits,
    misses,
    reasoning: `BLEU score: ${score.toFixed(3)}`,
    details: { bleu: score },
  };
});
