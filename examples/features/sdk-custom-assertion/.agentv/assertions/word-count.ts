#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

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

export default defineAssertion(({ output }) => {
  const outputText = getMessageText(output ?? []);
  const wordCount = outputText.trim().split(/\s+/).length;
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
