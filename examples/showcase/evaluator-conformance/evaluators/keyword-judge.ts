#!/usr/bin/env bun
/**
 * Sample evaluator for conformance testing.
 *
 * Deterministic keyword-matching judge: checks whether expected keywords
 * appear in the candidate answer. Produces stable scores for unambiguous
 * cases and variable scores for partial matches.
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ candidateAnswer, referenceAnswer, criteria }) => {
  const candidate = (candidateAnswer ?? '').toLowerCase().trim();
  const expected = (referenceAnswer ?? '').toLowerCase().trim();

  if (!candidate) {
    return {
      score: 0,
      hits: [],
      misses: ['Empty candidate answer'],
      reasoning: 'Candidate answer is empty.',
    };
  }

  // Extract keywords from expected output (split on commas, spaces, punctuation)
  const keywords = expected.split(/[\s,.:;!?]+/).filter((w) => w.length > 1);

  if (keywords.length === 0) {
    return {
      score: 0.5,
      hits: [],
      misses: [],
      reasoning: 'No keywords to match against.',
    };
  }

  const hits: string[] = [];
  const misses: string[] = [];

  for (const kw of keywords) {
    if (candidate.includes(kw)) {
      hits.push(`Contains "${kw}"`);
    } else {
      misses.push(`Missing "${kw}"`);
    }
  }

  const score = hits.length / keywords.length;

  return {
    score: Math.round(score * 100) / 100,
    hits,
    misses,
    reasoning: `Matched ${hits.length}/${keywords.length} keywords from expected output. Criteria: ${criteria}`,
  };
});
