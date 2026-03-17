#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ outputText }) => {
  const lower = outputText.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];

  if (lower.includes('paris')) {
    hits.push('Answer mentions Paris');
  } else {
    misses.push('Answer does not mention Paris');
  }

  if (lower.includes('france')) {
    hits.push('Answer mentions France');
  } else {
    misses.push('Answer does not mention France');
  }

  const total = hits.length + misses.length;
  return {
    score: total > 0 ? hits.length / total : 0,
    hits,
    misses,
    reasoning: `Passed ${hits.length}/${total} keyword checks`,
  };
});
