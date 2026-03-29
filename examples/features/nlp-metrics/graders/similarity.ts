#!/usr/bin/env bun
/**
 * Cosine Similarity Code Grader
 *
 * Computes cosine similarity between candidate and reference text using
 * token-overlap (bag-of-words) vectors. This is a lightweight alternative to
 * embedding-based similarity that requires no external dependencies.
 */
import { defineCodeGrader } from '@agentv/eval';

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

  const candTokens = tokenize(outputText);
  const refTokens = tokenize(reference);

  const candTf = termFrequency(candTokens);
  const refTf = termFrequency(refTokens);

  const cosine = cosineSimilarity(candTf, refTf);
  const jaccard = jaccardSimilarity(new Set(candTokens), new Set(refTokens));

  // Use cosine as the primary score
  const score = cosine;

  const assertions: Array<{ text: string; passed: boolean }> = [];

  if (cosine >= 0.7)
    assertions.push({ text: `Cosine similarity ${cosine.toFixed(3)} >= 0.7`, passed: true });
  else assertions.push({ text: `Cosine similarity ${cosine.toFixed(3)} < 0.7`, passed: false });

  if (jaccard >= 0.5)
    assertions.push({ text: `Jaccard similarity ${jaccard.toFixed(3)} >= 0.5`, passed: true });
  else assertions.push({ text: `Jaccard similarity ${jaccard.toFixed(3)} < 0.5`, passed: false });

  return {
    score,
    assertions,
    details: { cosine, jaccard },
  };
});
