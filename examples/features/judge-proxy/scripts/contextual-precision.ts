#!/usr/bin/env bun
/**
 * Contextual Precision Evaluator
 *
 * This code judge uses the judge proxy to evaluate contextual precision -
 * whether the agent's response is relevant to the original question.
 *
 * Requires `judge: { max_calls: 10 }` in the evaluator YAML config.
 *
 * The proxy allows code judges to make LLM calls without direct API access.
 */
// NOTE: In a real project, use: import { ... } from '@agentv/eval';
// This example uses a relative path for testing within the monorepo.
import {
  createJudgeProxyClientFromEnv,
  defineCodeJudge,
} from '../../../../packages/eval/src/index.js';

interface RelevanceResult {
  relevant: boolean;
  reasoning: string;
}

export default defineCodeJudge(async ({ question, candidateAnswer, expectedOutcome }) => {
  const judge = createJudgeProxyClientFromEnv();

  if (!judge) {
    // Proxy not available - likely missing `judge` config in YAML
    return {
      score: 0,
      hits: [],
      misses: ['Judge proxy not available - ensure `judge` block is configured in evaluator YAML'],
      reasoning: 'Cannot evaluate without judge proxy access',
    };
  }

  // Use the judge to evaluate relevance
  const response = await judge.invoke({
    question: `Evaluate if this response is contextually relevant to the question.

Question: ${question}
Expected outcome: ${expectedOutcome}
Response: ${candidateAnswer}

Respond with JSON only:
{
  "relevant": true/false,
  "reasoning": "brief explanation"
}`,
    systemPrompt:
      'You are a precise evaluator. Assess if the response addresses the question contextually. Output valid JSON only.',
  });

  // Parse the judge response
  const rawText = response.rawText ?? '';
  let result: RelevanceResult;

  try {
    // Try to extract JSON from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    result = JSON.parse(jsonMatch[0]) as RelevanceResult;
  } catch (error) {
    return {
      score: 0.5,
      hits: [],
      misses: ['Could not parse judge response'],
      reasoning: `Parse error: ${error instanceof Error ? error.message : String(error)}. Raw: ${rawText.slice(0, 200)}`,
    };
  }

  const score = result.relevant ? 1.0 : 0.0;

  return {
    score,
    hits: result.relevant ? ['Response is contextually relevant'] : [],
    misses: result.relevant ? [] : ['Response lacks contextual relevance'],
    reasoning: result.reasoning,
  };
});
