#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ outputText }) => {
  const lower = outputText.toLowerCase();
  const assertions: Array<{ text: string; passed: boolean }> = [];

  if (lower.includes('paris')) {
    assertions.push({ text: 'Answer mentions Paris', passed: true });
  } else {
    assertions.push({ text: 'Answer does not mention Paris', passed: false });
  }

  if (lower.includes('france')) {
    assertions.push({ text: 'Answer mentions France', passed: true });
  } else {
    assertions.push({ text: 'Answer does not mention France', passed: false });
  }

  const passed = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  return {
    score: total > 0 ? passed / total : 0,
    assertions,
  };
});
