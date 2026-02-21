#!/usr/bin/env bun
/**
 * Custom Prompt Template Demo
 *
 * Uses the declarative definePromptTemplate helper to generate
 * a custom evaluation prompt with full TypeScript support.
 */
import { definePromptTemplate } from '@agentv/eval';

export default definePromptTemplate((ctx) => {
  // Access typed config from YAML
  const rubric = ctx.config?.rubric as string | undefined;
  const strictMode = ctx.config?.strictMode as boolean | undefined;

  // Build conditional sections
  const referenceSection = ctx.referenceAnswer
    ? `\n## Reference Answer\n${ctx.referenceAnswer}`
    : '';

  const rubricSection = rubric ? `\n## Evaluation Rubric\n${rubric}` : '';

  const strictWarning = strictMode
    ? '\n**Note:** Strict mode enabled - minor inaccuracies should result in lower scores.'
    : '';

  return `You are evaluating an AI assistant's response.

## Question
${ctx.question}

## Candidate Answer
${ctx.answer}
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
- reasoning: Brief explanation of your evaluation
- hits: Array of positive aspects
- misses: Array of issues or missing elements`;
});
