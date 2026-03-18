#!/usr/bin/env bun
/**
 * Batch CLI Output Evaluator - Code Grader
 *
 * Validates that the batch CLI runner produces the expected decision
 * by comparing candidate output against expected_output or input.
 */
import { defineCodeGrader } from '@agentv/eval';

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

export default defineCodeGrader(({ expectedOutput, input, outputText }) => {
  const expectedDecision =
    findExpectedDecisionFromExpectedMessages(expectedOutput) ??
    findExpectedDecisionFromInputMessages(input);

  let candidateObj: unknown;
  try {
    candidateObj = JSON.parse(outputText);
  } catch {
    candidateObj = undefined;
  }

  const candidateDecision =
    isObject(candidateObj) && typeof candidateObj.decision === 'string'
      ? candidateObj.decision
      : undefined;

  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  if (!expectedDecision) {
    assertions.push({ text: 'Missing expected decision (expected_output[].content.decision)', passed: false });
  } else {
    assertions.push({ text: `expected.decision present: ${expectedDecision}`, passed: true });
  }

  if (!candidateDecision) {
    assertions.push({ text: 'Candidate output is not valid JSON with a decision field', passed: false });
  } else {
    assertions.push({ text: `candidate.decision present: ${candidateDecision}`, passed: true });
  }

  const ok =
    typeof expectedDecision === 'string' &&
    typeof candidateDecision === 'string' &&
    expectedDecision === candidateDecision;

  if (!ok) {
    assertions.push({
      text: `decision mismatch: expected=${expectedDecision ?? 'null'} actual=${candidateDecision ?? 'null'}`,
      passed: false,
    });
  }

  return {
    score: ok ? 1 : 0,
    assertions,
  };
});
