#!/usr/bin/env bun
/**
 * Test fixture for defineCodeGrader integration test.
 */
import { defineCodeGrader } from '../../../sdk/src/index.js';

export default defineCodeGrader(({ output, criteria }) => {
  const assertions: { text: string; passed: boolean }[] = [];

  // `output` is the final answer/scored result. Transcript-aware graders should
  // use messages/trace instead.
  const candidateText = output ?? '';

  // Simple check: does candidate mention the criteria keywords?
  const outcomeWords = criteria.toLowerCase().split(/\s+/);
  const candidateWords = candidateText.toLowerCase().split(/\s+/);

  for (const word of outcomeWords) {
    if (word.length > 3 && candidateWords.includes(word)) {
      assertions.push({ text: `Contains keyword: ${word}`, passed: true });
    }
  }

  if (assertions.length === 0) {
    assertions.push({ text: 'No matching keywords found', passed: false });
  }

  const score = assertions.some((a) => a.passed) ? 1.0 : 0.0;

  return {
    score,
    assertions,
  };
});
