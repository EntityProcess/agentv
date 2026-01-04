#!/usr/bin/env bun
/**
 * Simple test judge using the SDK
 */
import { readCodeJudgePayload } from '../../src/evaluation/code-judge-sdk.js';

try {
  const payload = readCodeJudgePayload();

  // Simple check: does the answer match the expected outcome?
  const matches = payload.candidateAnswer.includes(payload.expectedOutcome);

  console.log(JSON.stringify({
    score: matches ? 1 : 0,
    hits: matches ? ['Answer matches expected outcome'] : [],
    misses: matches ? [] : ['Answer does not match expected outcome'],
    reasoning: matches ? 'Test passed' : 'Test failed'
  }, null, 2));

} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({
    score: 0,
    hits: [],
    misses: [`Error: ${message}`],
    reasoning: 'Failed to parse payload'
  }, null, 2));
  process.exit(1);
}
