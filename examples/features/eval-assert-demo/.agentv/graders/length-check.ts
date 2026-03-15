#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ answer }) => {
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const hits: string[] = [];
  const misses: string[] = [];

  if (wordCount >= 5) {
    hits.push(`Answer has ${wordCount} words (>= 5)`);
  } else {
    misses.push(`Answer has only ${wordCount} words (need >= 5)`);
  }

  if (wordCount <= 50) {
    hits.push(`Answer has ${wordCount} words (<= 50, concise)`);
  } else {
    misses.push(`Answer has ${wordCount} words (> 50, too verbose)`);
  }

  const total = hits.length + misses.length;
  return {
    score: total > 0 ? hits.length / total : 0,
    hits,
    misses,
    reasoning: `Word count: ${wordCount}. Passed ${hits.length}/${total} checks.`,
  };
});
