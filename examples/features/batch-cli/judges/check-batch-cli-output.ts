#!/usr/bin/env bun
/**
 * Batch CLI Output Evaluator - Code Judge
 *
 * Validates that the batch CLI runner produces the expected decision
 * by comparing candidate output against expected_output or input.
 */
import { defineCodeJudge } from '@agentv/eval';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findExpectedDecisionFromExpectedMessages(
  expectedOutput: readonly Record<string, unknown>[],
): string | undefined {
  for (const msg of expectedOutput) {
    if (!isObject(msg)) continue;
    const content = msg.content;
    if (!isObject(content)) continue;

    const decision = content.decision;
    if (typeof decision === 'string' && decision.trim().length > 0) {
      return decision.trim();
    }
  }
  return undefined;
}

function findExpectedDecisionFromInputMessages(
  input: readonly Record<string, unknown>[],
): string | undefined {
  for (const msg of input) {
    if (!isObject(msg)) continue;
    if (msg.role !== 'user') continue;
    const content = msg.content;
    if (!isObject(content)) continue;

    const expected = content.expected;
    if (!isObject(expected)) continue;

    const decision = expected.decision;
    if (typeof decision === 'string' && decision.trim().length > 0) {
      return decision.trim();
    }
  }
  return undefined;
}

export default defineCodeJudge(({ expectedOutput, input, answer }) => {
  const expectedDecision =
    findExpectedDecisionFromExpectedMessages(expectedOutput) ??
    findExpectedDecisionFromInputMessages(input);

  let candidateObj: unknown;
  try {
    candidateObj = JSON.parse(answer);
  } catch {
    candidateObj = undefined;
  }

  const candidateDecision =
    isObject(candidateObj) && typeof candidateObj.decision === 'string'
      ? candidateObj.decision
      : undefined;

  const hits: string[] = [];
  const misses: string[] = [];

  if (!expectedDecision) {
    misses.push('Missing expected decision (expected_output[].content.decision)');
  } else {
    hits.push(`expected.decision present: ${expectedDecision}`);
  }

  if (!candidateDecision) {
    misses.push('Candidate output is not valid JSON with a decision field');
  } else {
    hits.push(`candidate.decision present: ${candidateDecision}`);
  }

  const ok =
    typeof expectedDecision === 'string' &&
    typeof candidateDecision === 'string' &&
    expectedDecision === candidateDecision;

  if (!ok) {
    misses.push(
      `decision mismatch: expected=${expectedDecision ?? 'null'} actual=${candidateDecision ?? 'null'}`,
    );
  }

  return {
    score: ok ? 1 : 0,
    hits,
    misses,
    reasoning: ok
      ? 'Batch runner decision matches the expected decision.'
      : 'Batch runner decision did not match expected decision.',
  };
});
