#!/usr/bin/env bun
/**
 * Trial Output Consistency Grader
 *
 * Computes consistency across repeated trial outputs using embedding similarity.
 * Uses the Vercel AI SDK for embeddings via AgentV's target client, with a
 * token-overlap cosine similarity fallback when embeddings are unavailable.
 *
 * Config:
 *   trialOutputs: string[]  — array of outputs from repeated trials
 *   fallback?: "token"      — force token-overlap mode (skip embeddings)
 *
 * Edge cases:
 *   0 trials  → score 0, miss reported
 *   1 trial   → score 1.0 (perfect consistency by definition)
 *   2+ trials → average pairwise cosine similarity
 */
import { createTargetClient, defineCodeGrader, z } from '@agentv/eval';

const ConfigSchema = z.object({
  trialOutputs: z.array(z.string()),
  fallback: z.enum(['token']).optional(),
});

// ── Token-overlap cosine similarity (fallback) ──────────────────────────

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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function tokenVectors(texts: string[]): number[][] {
  const allTokens = new Set<string>();
  const tfs = texts.map((t) => {
    const tokens = tokenize(t);
    for (const tok of tokens) allTokens.add(tok);
    return termFrequency(tokens);
  });
  const vocab = [...allTokens];
  return tfs.map((tf) => vocab.map((w) => tf.get(w) ?? 0));
}

// ── Embedding via target client ─────────────────────────────────────────

async function getEmbeddings(texts: string[]): Promise<number[][] | null> {
  const target = createTargetClient();
  if (!target) return null;

  try {
    const requests = texts.map((text) => ({
      question: text,
      systemPrompt:
        'Return ONLY a JSON array of 64 floating-point numbers representing a semantic embedding of the user message. No explanation.',
    }));
    const responses = await target.invokeBatch(requests);
    const embeddings: number[][] = [];
    for (const r of responses) {
      const raw = r.rawText ?? '';
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      embeddings.push(parsed.map(Number));
    }
    return embeddings;
  } catch {
    return null;
  }
}

// ── Pairwise average similarity ─────────────────────────────────────────

function averagePairwiseSimilarity(vectors: number[][]): number {
  const n = vectors.length;
  if (n < 2) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += cosineSimilarity(vectors[i], vectors[j]);
      count++;
    }
  }
  return sum / count;
}

// ── Grader ───────────────────────────────────────────────────────────────

export default defineCodeGrader(async (input) => {
  const parsed = ConfigSchema.safeParse(input.config ?? {});
  if (!parsed.success) {
    return {
      score: 0,
      assertions: [
        {
          text: 'Invalid config: trialOutputs (string[]) is required',
          passed: false,
          evidence: `Config validation failed: ${parsed.error.message}`,
        },
      ],
    };
  }

  const { trialOutputs, fallback } = parsed.data;

  // Edge case: 0 trials
  if (trialOutputs.length === 0) {
    return {
      score: 0,
      assertions: [{ text: 'No trial outputs provided (0 trials)', passed: false }],
    };
  }

  // Edge case: 1 trial
  if (trialOutputs.length === 1) {
    return {
      score: 1,
      assertions: [{ text: 'Single trial — perfect consistency by definition', passed: true }],
      details: { trialCount: 1, method: 'trivial' },
    };
  }

  // 2+ trials: compute pairwise similarity
  let vectors: number[][] | null = null;
  let method = 'token-overlap';

  if (fallback !== 'token') {
    vectors = await getEmbeddings(trialOutputs);
    if (vectors) method = 'embedding';
  }

  if (!vectors) {
    vectors = tokenVectors(trialOutputs);
    method = 'token-overlap';
  }

  const score = averagePairwiseSimilarity(vectors);
  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  if (score >= 0.8) {
    assertions.push({ text: `High consistency: ${score.toFixed(3)}`, passed: true });
  } else if (score >= 0.5) {
    assertions.push({ text: `Moderate consistency: ${score.toFixed(3)}`, passed: true });
  } else {
    assertions.push({ text: `Low consistency: ${score.toFixed(3)}`, passed: false });
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    assertions,
    details: {
      trialCount: trialOutputs.length,
      method,
      pairCount: (trialOutputs.length * (trialOutputs.length - 1)) / 2,
    },
  };
});
