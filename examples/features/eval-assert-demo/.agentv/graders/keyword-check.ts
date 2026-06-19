#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/sdk';

export default defineCodeGrader(({ output }) => {
  const outputText = output ?? '';
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

  const passed = assertions.filter((assertion) => assertion.passed).length;
  return { score: passed / assertions.length, assertions };
});
