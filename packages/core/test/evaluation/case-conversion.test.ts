import { describe, expect, it } from 'bun:test';

import {
  type EvaluationResult,
  parseEvaluationResultBoundary,
  serializeEvaluationResultWire,
  toCamelCaseDeep,
  toSnakeCaseDeep,
} from '../../src/index.js';

describe('case conversion', () => {
  it('converts camelCase keys to snake_case recursively', () => {
    expect(
      toSnakeCaseDeep({
        testId: 'test-001',
        outputText: 'hello world',
        conversationId: 'conv-123',
        trace: {
          toolCalls: 5,
          totalSteps: 10,
        },
        scores: [
          { evalName: 'test1', hitCount: 3 },
          { evalName: 'test2', hitCount: 5 },
        ],
      }),
    ).toEqual({
      test_id: 'test-001',
      output_text: 'hello world',
      conversation_id: 'conv-123',
      trace: {
        tool_calls: 5,
        total_steps: 10,
      },
      scores: [
        { eval_name: 'test1', hit_count: 3 },
        { eval_name: 'test2', hit_count: 5 },
      ],
    });
  });

  it('preserves primitive values and arrays of primitives', () => {
    expect(toSnakeCaseDeep('hello')).toBe('hello');
    expect(toSnakeCaseDeep(42)).toBe(42);
    expect(toSnakeCaseDeep(true)).toBe(true);
    expect(toSnakeCaseDeep(null)).toBe(null);
    expect(toSnakeCaseDeep(undefined)).toBe(undefined);
    expect(toSnakeCaseDeep([1, 2, 3, 'test'])).toEqual([1, 2, 3, 'test']);
  });

  it('keeps acronym and proper-noun keys while converting their nested payloads', () => {
    expect(
      toSnakeCaseDeep({
        HTTPStatus: 200,
        Read: { filePath: 'src/index.ts' },
        Edit: { targetFile: 'src/index.ts' },
        topP: 0.8,
      }),
    ).toEqual({
      HTTPStatus: 200,
      Read: { file_path: 'src/index.ts' },
      Edit: { target_file: 'src/index.ts' },
      top_p: 0.8,
    });
  });

  it('converts snake_case keys to camelCase with digit boundaries', () => {
    expect(
      toCamelCaseDeep({
        HTTPStatus: 200,
        Read: { file_path: 'src/index.ts' },
        Edit: { target_file: 'src/index.ts' },
        top_p: 0.8,
        top_2: true,
      }),
    ).toEqual({
      HTTPStatus: 200,
      Read: { filePath: 'src/index.ts' },
      Edit: { targetFile: 'src/index.ts' },
      topP: 0.8,
      top2: true,
    });
  });
});

describe('evaluation result boundary serializer', () => {
  const result = {
    timestamp: '2026-06-30T00:00:00.000Z',
    testId: 'case-1',
    score: 1,
    assertions: [],
    target: 'mock',
    output: 'done',
    trace: {
      eventCount: 0,
      toolCalls: {},
      errorCount: 0,
      messages: [],
      events: [],
      extraTraceField: { topP: 0.5 },
    },
    executionStatus: 'ok',
    experimentalField: {
      topP: 0.8,
      top2: true,
      Read: { filePath: 'src/index.ts' },
    },
  } as EvaluationResult & {
    readonly experimentalField: Record<string, unknown>;
  };

  it('validates camelCase internals and serializes snake_case wire fields', () => {
    const wire = serializeEvaluationResultWire(result);

    expect(wire).toMatchObject({
      test_id: 'case-1',
      execution_status: 'ok',
      trace: {
        event_count: 0,
        tool_calls: {},
        error_count: 0,
        extra_trace_field: { top_p: 0.5 },
      },
      experimental_field: {
        top_p: 0.8,
        top2: true,
        Read: { file_path: 'src/index.ts' },
      },
    });
  });

  it('keeps unknown camelCase keys when parsing boundary-normalized internals', () => {
    const parsed = parseEvaluationResultBoundary(result) as EvaluationResult & {
      readonly experimentalField: Record<string, unknown>;
    };

    expect(parsed.experimentalField).toEqual(result.experimentalField);
    expect((parsed.trace as Record<string, unknown>).extraTraceField).toEqual({ topP: 0.5 });
  });
});
