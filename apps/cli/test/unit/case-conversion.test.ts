import { describe, expect, test } from 'vitest';

import { toSnakeCaseDeep } from '../../src/utils/case-conversion.js';

describe('toSnakeCaseDeep', () => {
  test('converts simple camelCase keys to snake_case', () => {
    const input = {
      testId: 'test-001',
      candidateAnswer: 'hello world',
      conversationId: 'conv-123',
    };

    const result = toSnakeCaseDeep(input);

    expect(result).toEqual({
      test_id: 'test-001',
      candidate_answer: 'hello world',
      conversation_id: 'conv-123',
    });
  });

  test('converts nested objects recursively', () => {
    const input = {
      testId: 'test-001',
      traceSummary: {
        toolCalls: 5,
        totalSteps: 10,
      },
    };

    const result = toSnakeCaseDeep(input);

    expect(result).toEqual({
      test_id: 'test-001',
      trace_summary: {
        tool_calls: 5,
        total_steps: 10,
      },
    });
  });

  test('converts arrays of objects', () => {
    const input = {
      evaluatorResults: [
        { evalName: 'test1', hitCount: 3 },
        { evalName: 'test2', hitCount: 5 },
      ],
    };

    const result = toSnakeCaseDeep(input);

    expect(result).toEqual({
      evaluator_results: [
        { eval_name: 'test1', hit_count: 3 },
        { eval_name: 'test2', hit_count: 5 },
      ],
    });
  });

  test('preserves primitive values', () => {
    expect(toSnakeCaseDeep('hello')).toBe('hello');
    expect(toSnakeCaseDeep(42)).toBe(42);
    expect(toSnakeCaseDeep(true)).toBe(true);
    expect(toSnakeCaseDeep(null)).toBe(null);
    expect(toSnakeCaseDeep(undefined)).toBe(undefined);
  });

  test('handles arrays of primitives', () => {
    const input = [1, 2, 3, 'test'];
    expect(toSnakeCaseDeep(input)).toEqual([1, 2, 3, 'test']);
  });

  test('handles complex nested structures', () => {
    const input = {
      timestamp: '2025-01-02T00:00:00Z',
      testId: 'test-001',
      agentProviderRequest: {
        modelName: 'gpt-4',
        maxTokens: 1000,
      },
      evaluatorResults: [
        {
          evaluatorName: 'code_judge',
          rawRequest: {
            candidateAnswer: 'code',
            expectedOutcome: 'correct',
          },
        },
      ],
      hits: ['check1', 'check2'],
      score: 0.85,
    };

    const result = toSnakeCaseDeep(input);

    expect(result).toEqual({
      timestamp: '2025-01-02T00:00:00Z',
      test_id: 'test-001',
      agent_provider_request: {
        model_name: 'gpt-4',
        max_tokens: 1000,
      },
      evaluator_results: [
        {
          evaluator_name: 'code_judge',
          raw_request: {
            candidate_answer: 'code',
            expected_outcome: 'correct',
          },
        },
      ],
      hits: ['check1', 'check2'],
      score: 0.85,
    });
  });

  test('handles keys that are already snake_case', () => {
    const input = {
      test_id: 'test-001',
      candidate_answer: 'hello',
    };

    const result = toSnakeCaseDeep(input);

    expect(result).toEqual({
      test_id: 'test-001',
      candidate_answer: 'hello',
    });
  });
});
