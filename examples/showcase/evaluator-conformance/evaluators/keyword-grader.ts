#!/usr/bin/env bun
/**
 * Sample evaluator for conformance testing.
 *
 * Deterministic keyword-matching grader: checks whether expected keywords
 * appear in the candidate output. Produces stable scores for unambiguous
 * cases and variable scores for partial matches.
 */
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ outputText, expectedOutputText, criteria }) => {
  const candidate = (outputText ?? '').toLowerCase().trim();
  const expected = (expectedOutputText ?? '').toLowerCase().trim();

  if (!candidate) {
    return {
      score: 0,
      assertions: [{ text: 'Empty candidate output', passed: false }],
    };
  }

  // Extract keywords from expected output (split on commas, spaces, punctuation)
  const keywords = expected.split(/[\s,.:;!?]+/).filter((w) => w.length > 1);

  if (keywords.length === 0) {
    return {
      score: 0.5,
      assertions: [],
    };
  }

  const assertions: Array<{ text: string; passed: boolean }> = [];

  for (const kw of keywords) {
    if (candidate.includes(kw)) {
      assertions.push({ text: `Contains "${kw}"`, passed: true });
    } else {
      assertions.push({ text: `Missing "${kw}"`, passed: false });
    }
  }

  const matched = assertions.filter((a) => a.passed).length;
  const score = matched / keywords.length;

  return {
    score: Math.round(score * 100) / 100,
    assertions,
  };
});
