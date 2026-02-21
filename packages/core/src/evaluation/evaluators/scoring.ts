import type { EvaluationScore } from './types.js';
import type { EvaluationVerdict } from '../types.js';

export function scoreToVerdict(score: number): EvaluationVerdict {
  if (score >= 0.8) {
    return 'pass';
  }
  if (score >= 0.6) {
    return 'borderline';
  }
  return 'fail';
}

export function clampScore(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function extractJsonBlob(text: string): string | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  return match?.[0];
}

export function parseJsonFromText(text: string): unknown {
  const cleaned = typeof text === 'string' ? text.replace(/```json\n?|```/g, '').trim() : '';
  const blob = extractJsonBlob(cleaned) ?? cleaned;
  return JSON.parse(blob);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseJsonSafe(payload: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(bObj, key) && deepEqual(aObj[key], bObj[key]));
}

/**
 * Negate an evaluation score: inverts score (1 - score), swaps pass/fail verdict,
 * swaps hits/misses, and annotates reasoning.
 */
export function negateScore(score: EvaluationScore): EvaluationScore {
  const negatedScore = clampScore(1 - score.score);
  const negatedVerdict: EvaluationVerdict =
    score.verdict === 'pass' ? 'fail' : score.verdict === 'fail' ? 'pass' : 'borderline';
  return {
    ...score,
    score: negatedScore,
    verdict: negatedVerdict,
    reasoning: score.reasoning
      ? `[Negated] ${score.reasoning} (original score: ${score.score.toFixed(2)})`
      : `[Negated] Original score: ${score.score.toFixed(2)}`,
    hits: score.misses,
    misses: score.hits,
  };
}
