#!/usr/bin/env bun
/**
 * Custom Prompt Template Demo
 *
 * Uses the declarative definePromptTemplate helper to generate
 * a custom evaluation prompt with full TypeScript support.
 */
import { definePromptTemplate } from '@agentv/eval';

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

export default definePromptTemplate((ctx) => {
  const inputText = getMessageText(ctx.input, 'user');
  const outputText = getMessageText(ctx.output ?? []);
  const expectedOutputText = getMessageText(ctx.expectedOutput);

  // Access typed config from YAML
  const rubric = ctx.config?.rubric as string | undefined;
  const strictMode = ctx.config?.strictMode as boolean | undefined;

  // Build conditional sections
  const referenceSection = expectedOutputText ? `\n## Reference Answer\n${expectedOutputText}` : '';

  const rubricSection = rubric ? `\n## Evaluation Rubric\n${rubric}` : '';

  const strictWarning = strictMode
    ? '\n**Note:** Strict mode enabled - minor inaccuracies should result in lower scores.'
    : '';

  return `You are evaluating an AI assistant's response.

## Question
${inputText}

## Candidate Answer
${outputText}
${referenceSection}
${rubricSection}
${strictWarning}

## Instructions
Evaluate the candidate answer based on:
1. Correctness - Does it accurately answer the question?
2. Completeness - Does it address all parts of the question?
3. Clarity - Is the response clear and well-structured?

Respond with a JSON object containing:
- score: A number from 0 to 1
- assertions: Array of { text: string, passed: boolean, evidence?: string } entries describing each check`;
});
