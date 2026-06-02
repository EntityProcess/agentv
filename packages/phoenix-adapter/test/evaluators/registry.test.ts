import { describe, expect, test } from 'bun:test';
import {
  createEvaluatorRegistry,
  isSupportedEvaluatorType,
  unsupportedEvaluatorReports,
  unsupportedEvaluatorTypes,
} from '../../src/evaluators/registry.js';
import type { NormalizedAssertionConfig } from '../../src/evaluators/types.js';

describe('evaluator registry', () => {
  test('marks deterministic evaluator families as supported', () => {
    expect(isSupportedEvaluatorType('contains')).toBe(true);
    expect(isSupportedEvaluatorType('regex')).toBe(true);
    expect(isSupportedEvaluatorType('equals')).toBe(true);
    expect(isSupportedEvaluatorType('is-json')).toBe(true);
  });

  test('builds adapters for supported and unsupported evaluators', () => {
    const registry = createEvaluatorRegistry([
      { type: 'contains', value: 'ok' },
      { type: 'llm-grader', name: 'judge answer' },
    ]);

    expect(registry).toHaveLength(2);
    expect(registry[0]?.supported).toBe(true);
    expect(registry[1]?.supported).toBe(false);

    const unsupportedResult = registry[1]?.evaluate({ output: 'ok' });

    expect(unsupportedResult).toMatchObject({
      name: 'judge answer',
      type: 'llm-grader',
      passed: false,
      score: 0,
      label: 'unsupported',
      unsupported: true,
    });
  });

  test('reports every first-pass unsupported evaluator family with a reason', () => {
    const assertions: NormalizedAssertionConfig[] = unsupportedEvaluatorTypes.map((type) => ({
      type,
      name: `${type} assertion`,
      metadata: { testId: type },
    }));

    const reports = unsupportedEvaluatorReports(assertions);

    expect(reports).toHaveLength(unsupportedEvaluatorTypes.length);

    for (const type of unsupportedEvaluatorTypes) {
      const report = reports.find((entry) => entry.type === type);

      expect(report?.name).toBe(`${type} assertion`);
      expect(report?.reason.length).toBeGreaterThan(0);
      expect(report?.metadata).toEqual({ testId: type });
    }
  });

  test('reports unknown evaluator families instead of silently treating them as supported', () => {
    const [report] = unsupportedEvaluatorReports([{ type: 'custom-family', name: 'custom' }]);

    expect(report).toMatchObject({
      name: 'custom',
      type: 'custom-family',
      reason: 'Unknown evaluator family: custom-family',
    });
  });
});
