#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

function getMessageText(
  messages: readonly { role: string; content?: unknown }[],
  role = 'assistant',
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === role) {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((b: { type?: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text)
          .join('\n');
      }
    }
  }
  return '';
}

export default defineCodeGrader(({ output }) => {
  const outputText = getMessageText(output ?? []);
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
