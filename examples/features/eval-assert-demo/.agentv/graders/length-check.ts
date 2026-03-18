#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ outputText }) => {
  const wordCount = outputText.split(/\s+/).filter(Boolean).length;
  const assertions: Array<{ text: string; passed: boolean }> = [];

  if (wordCount >= 5) {
    assertions.push({ text: `Answer has ${wordCount} words (>= 5)`, passed: true });
  } else {
    assertions.push({ text: `Answer has only ${wordCount} words (need >= 5)`, passed: false });
  }

  if (wordCount <= 50) {
    assertions.push({ text: `Answer has ${wordCount} words (<= 50, concise)`, passed: true });
  } else {
    assertions.push({ text: `Answer has ${wordCount} words (> 50, too verbose)`, passed: false });
  }

  const passed = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  return {
    score: total > 0 ? passed / total : 0,
    assertions,
  };
});
