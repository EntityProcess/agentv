#!/usr/bin/env bun
/**
 * Test fixture for defineCodeJudge integration test.
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ answer, criteria }) => {
  const hits: string[] = [];
  const misses: string[] = [];

  // Simple check: does candidate mention the criteria keywords?
  const outcomeWords = criteria.toLowerCase().split(/\s+/);
  const candidateWords = answer.toLowerCase().split(/\s+/);

  for (const word of outcomeWords) {
    if (word.length > 3 && candidateWords.includes(word)) {
      hits.push(`Contains keyword: ${word}`);
    }
  }

  if (hits.length === 0) {
    misses.push('No matching keywords found');
  }

  const score = hits.length > 0 ? 1.0 : 0.0;

  return {
    score,
    hits,
    misses,
    reasoning: `Found ${hits.length} matching keywords`,
  };
});
