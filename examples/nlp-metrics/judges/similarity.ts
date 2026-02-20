#!/usr/bin/env bun
/**
 * Cosine Similarity Code Judge
 *
 * Computes cosine similarity between candidate and reference text using
 * token-overlap (bag-of-words) vectors. This is a lightweight alternative to
 * embedding-based similarity that requires no external dependencies.
 */
import { defineCodeJudge } from '@agentv/eval';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  const allKeys = new Set([...a.keys(), ...b.keys()]);

  for (const key of allKeys) {
    const va = a.get(key) ?? 0;
    const vb = b.get(key) ?? 0;
    dotProduct += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
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

  const candTokens = tokenize(candidateAnswer);
  const refTokens = tokenize(reference);

  const candTf = termFrequency(candTokens);
  const refTf = termFrequency(refTokens);

  const cosine = cosineSimilarity(candTf, refTf);
  const jaccard = jaccardSimilarity(new Set(candTokens), new Set(refTokens));

  // Use cosine as the primary score
  const score = cosine;

  const hits: string[] = [];
  const misses: string[] = [];

  if (cosine >= 0.7) hits.push(`Cosine similarity ${cosine.toFixed(3)} >= 0.7`);
  else misses.push(`Cosine similarity ${cosine.toFixed(3)} < 0.7`);

  if (jaccard >= 0.5) hits.push(`Jaccard similarity ${jaccard.toFixed(3)} >= 0.5`);
  else misses.push(`Jaccard similarity ${jaccard.toFixed(3)} < 0.5`);

  return {
    score,
    hits,
    misses,
    reasoning: `Cosine=${cosine.toFixed(3)}, Jaccard=${jaccard.toFixed(3)}`,
    details: { cosine, jaccard },
  };
});
