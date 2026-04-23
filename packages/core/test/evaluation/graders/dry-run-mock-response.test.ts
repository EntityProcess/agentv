/**
 * Regression test: --dry-run mock response satisfies all LLM grader schemas.
 *
 * Before the fix, dry-run returned '{"answer":"Mock dry-run response"}' which
 * caused LLM graders to fail with "Required: score" parse errors. This test
 * ensures the mock response string is always schema-compatible.
 */

import { describe, expect, it } from 'bun:test';

import {
  freeformEvaluationSchema,
  rubricEvaluationSchema,
  scoreRangeEvaluationSchema,
} from '../../../src/evaluation/graders/llm-grader.js';

const DRY_RUN_MOCK_RESPONSE =
  '{"score":1,"assertions":[],"checks":[],"overall_reasoning":"dry-run mock"}';

describe('dry-run mock response schema compatibility', () => {
  it('is valid JSON', () => {
    expect(() => JSON.parse(DRY_RUN_MOCK_RESPONSE)).not.toThrow();
  });

  it('satisfies freeformEvaluationSchema (requires score)', () => {
    const parsed = JSON.parse(DRY_RUN_MOCK_RESPONSE);
    const result = freeformEvaluationSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.score).toBe(1);
    }
  });

  it('satisfies rubricEvaluationSchema (requires checks and overall_reasoning)', () => {
    const parsed = JSON.parse(DRY_RUN_MOCK_RESPONSE);
    const result = rubricEvaluationSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checks).toEqual([]);
      expect(result.data.overall_reasoning).toBe('dry-run mock');
    }
  });

  it('satisfies scoreRangeEvaluationSchema (requires checks, optional overall_reasoning)', () => {
    const parsed = JSON.parse(DRY_RUN_MOCK_RESPONSE);
    const result = scoreRangeEvaluationSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checks).toEqual([]);
    }
  });
});
