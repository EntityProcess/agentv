#!/usr/bin/env bun
/**
 * ROUGE-N Code Judge
 *
 * Computes ROUGE-1 and ROUGE-2 F1 scores between candidate and reference text.
 * ROUGE (Recall-Oriented Understudy for Gisting Evaluation) measures n-gram
 * overlap, commonly used for summarisation evaluation.
 */
import { defineCodeJudge } from '@agentv/eval';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join(' ');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function rougeN(candidate: string, reference: string, n: number) {
  const candTokens = tokenize(candidate);
  const refTokens = tokenize(reference);

  const candGrams = ngrams(candTokens, n);
  const refGrams = ngrams(refTokens, n);

  let overlap = 0;
  for (const [gram, count] of refGrams) {
    overlap += Math.min(count, candGrams.get(gram) ?? 0);
  }

  const totalRef = Array.from(refGrams.values()).reduce((a, b) => a + b, 0);
  const totalCand = Array.from(candGrams.values()).reduce((a, b) => a + b, 0);

  const recall = totalRef === 0 ? 0 : overlap / totalRef;
  const precision = totalCand === 0 ? 0 : overlap / totalCand;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1 };
}

export default defineCodeJudge(({ candidateAnswer, referenceAnswer, expectedMessages }) => {
  const reference =
    referenceAnswer ??
    (expectedMessages[0] && typeof expectedMessages[0].content === 'string'
      ? expectedMessages[0].content
      : '');

  if (!reference) {
    return { score: 0, misses: ['No reference text provided'], reasoning: 'Missing reference.' };
  }

  const rouge1 = rougeN(candidateAnswer, reference, 1);
  const rouge2 = rougeN(candidateAnswer, reference, 2);

  const score = rouge1.f1;

  const hits: string[] = [];
  const misses: string[] = [];

  if (rouge1.f1 >= 0.5) hits.push(`ROUGE-1 F1 ${rouge1.f1.toFixed(3)} >= 0.5`);
  else misses.push(`ROUGE-1 F1 ${rouge1.f1.toFixed(3)} < 0.5`);

  if (rouge2.f1 >= 0.3) hits.push(`ROUGE-2 F1 ${rouge2.f1.toFixed(3)} >= 0.3`);
  else misses.push(`ROUGE-2 F1 ${rouge2.f1.toFixed(3)} < 0.3`);

  return {
    score,
    hits,
    misses,
    reasoning: `ROUGE-1 F1=${rouge1.f1.toFixed(3)}, ROUGE-2 F1=${rouge2.f1.toFixed(3)}`,
    details: { rouge1, rouge2 },
  };
});
