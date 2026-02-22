#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer }) => {
  const wordCount = answer.trim().split(/\s+/).length;
  const minWords = 3;
  const pass = wordCount >= minWords;

  return {
    pass,
    score: pass ? 1.0 : Math.min(wordCount / minWords, 0.9),
    reasoning: pass
      ? `Output has ${wordCount} words (>= ${minWords} required)`
      : `Output has only ${wordCount} words (need >= ${minWords})`,
  };
});
