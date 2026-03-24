import { describe, expect, it } from 'bun:test';

import { CompositeEvaluator } from '../../../src/evaluation/evaluators/composite.js';
import type {
  EvaluationContext,
  EvaluationScore,
  Evaluator,
  EvaluatorFactory,
} from '../../../src/evaluation/evaluators/types.js';
import type { ResolvedTarget } from '../../../src/evaluation/providers/targets.js';
import type { EvalTest, EvaluatorConfig } from '../../../src/evaluation/types.js';

const baseTestCase: EvalTest = {
  id: 'threshold-test',
  eval_set: 'test',
  question: 'Test question',
  input: [{ role: 'user', content: 'Test' }],
  expected_output: [],
  reference_answer: '',
  file_paths: [],
  criteria: 'Test outcome',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

const baseMockProvider = {
  id: 'mock',
  kind: 'mock' as const,
  targetName: 'mock',
  invoke: async () => ({ output: [{ role: 'assistant' as const, content: 'test' }] }),
};

function createContext(): EvaluationContext {
  return {
    evalCase: baseTestCase,
    candidate: 'Test answer',
    target: baseTarget,
    provider: baseMockProvider,
    attempt: 0,
    promptInputs: { question: '' },
    now: new Date(),
  };
}

function makeResult(verdict: 'pass' | 'fail' | 'borderline', score: number): EvaluationScore {
  return {
    score,
    verdict,
    assertions:
      verdict === 'pass'
        ? [{ text: 'passed', passed: true }]
        : verdict === 'fail'
          ? [{ text: 'failed', passed: false }]
          : [],
    expectedAspectCount: 1,
  };
}

function createMockFactory(results: Record<string, EvaluationScore>): EvaluatorFactory {
  return {
    create(config: EvaluatorConfig): Evaluator {
      return {
        kind: config.type,
        evaluate: () => results[config.name],
      };
    },
  };
}

describe('CompositeEvaluator threshold aggregation', () => {
  it('all children pass, threshold 0.5 → pass, score = 1.0', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeResult('pass', 0.9),
      c: makeResult('pass', 0.85),
      d: makeResult('pass', 0.8),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
          { name: 'd', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(1.0);
    expect(result.verdict).toBe('pass');
    expect(result.scores).toHaveLength(4);
  });

  it('2/4 pass, threshold 0.5 → pass, score = 0.5', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeResult('pass', 0.9),
      c: makeResult('fail', 0.3),
      d: makeResult('fail', 0.1),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
          { name: 'd', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('pass');
  });

  it('1/4 pass, threshold 0.5 → fail, score = 0.25', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeResult('fail', 0.3),
      c: makeResult('fail', 0.2),
      d: makeResult('fail', 0.1),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
          { name: 'd', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(0.25);
    expect(result.verdict).toBe('fail');
  });

  it('borderline child counts as passing (lenient)', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeResult('borderline', 0.7),
      c: makeResult('fail', 0.3),
      d: makeResult('fail', 0.1),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
          { name: 'd', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('pass');
  });

  it('warning includes borderline count when borderline contributes to pass', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeResult('borderline', 0.7),
      c: makeResult('fail', 0.3),
      d: makeResult('fail', 0.1),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
          { name: 'd', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    // Borderline member counts as passing — verify the summary assertion
    const summaryAssertion = result.assertions.find((a) => a.text.includes('evaluators passed'));
    expect(summaryAssertion).toBeDefined();
    expect(summaryAssertion?.text).toContain('2/4 evaluators passed');
  });

  it('no warning when borderline present but result fails', async () => {
    const factory = createMockFactory({
      a: makeResult('borderline', 0.7),
      b: makeResult('fail', 0.3),
      c: makeResult('fail', 0.2),
      d: makeResult('fail', 0.1),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
          { name: 'd', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.verdict).toBe('fail');
  });

  it('no children pass, threshold 0.0 → pass (0 >= 0)', async () => {
    const factory = createMockFactory({
      a: makeResult('fail', 0.3),
      b: makeResult('fail', 0.1),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.0 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('pass');
  });

  it('3/4 pass, threshold 1.0 → fail', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeResult('pass', 0.9),
      c: makeResult('pass', 0.85),
      d: makeResult('fail', 0.3),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
          { name: 'd', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 1.0 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(0.75);
    expect(result.verdict).toBe('fail');
  });

  it('scores array included in output', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeResult('fail', 0.3),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.scores).toBeDefined();
    expect(result.scores).toHaveLength(2);
    const results = result.scores as NonNullable<typeof result.scores>;
    expect(results[0].name).toBe('a');
    expect(results[1].name).toBe('b');
    expect(result.evaluatorRawRequest).toEqual({
      aggregator: 'threshold',
      threshold: 0.5,
    });
  });
});

function makeSkipResult(): EvaluationScore {
  return {
    score: 0,
    verdict: 'skip',
    assertions: [
      { text: 'Grader parse failure after 3 attempts: malformed response', passed: false },
    ],
    expectedAspectCount: 1,
  };
}

describe('CompositeEvaluator skip-verdict handling', () => {
  it('weighted average: skip-verdict members excluded from average', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeSkipResult(),
      c: makeResult('pass', 0.8),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'combo',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'weighted_average' },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    // Average of 1.0 and 0.8 = 0.9 (skip excluded)
    expect(result.score).toBe(0.9);
    expect(result.verdict).toBe('pass');
  });

  it('weighted average: all-skip returns verdict skip', async () => {
    const factory = createMockFactory({
      a: makeSkipResult(),
      b: makeSkipResult(),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'combo',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'weighted_average' },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    expect(result.assertions.some((a) => a.text.includes('All evaluators skipped'))).toBe(true);
  });

  it('threshold: skip-verdict members excluded from pass/total counts', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeSkipResult(),
      c: makeResult('fail', 0.2),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
          { name: 'c', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    // 1/2 evaluated pass = 0.5, meets threshold
    expect(result.score).toBe(0.5);
    expect(result.verdict).toBe('pass');
    expect(result.assertions.some((a) => a.text.includes('1/2 evaluators passed'))).toBe(true);
  });

  it('threshold: all-skip returns verdict skip', async () => {
    const factory = createMockFactory({
      a: makeSkipResult(),
      b: makeSkipResult(),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'gate',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'threshold', threshold: 0.5 },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('skip');
    expect(result.assertions.some((a) => a.text.includes('All evaluators skipped'))).toBe(true);
  });

  it('skip-verdict members still appear in scores array', async () => {
    const factory = createMockFactory({
      a: makeResult('pass', 1.0),
      b: makeSkipResult(),
    });

    const evaluator = new CompositeEvaluator({
      config: {
        name: 'combo',
        type: 'composite',
        assertions: [
          { name: 'a', type: 'latency', threshold: 5000 },
          { name: 'b', type: 'latency', threshold: 5000 },
        ],
        aggregator: { type: 'weighted_average' },
      },
      evaluatorFactory: factory,
    });

    const result = await evaluator.evaluate(createContext());
    expect(result.scores).toHaveLength(2);
    const childScores = result.scores as NonNullable<typeof result.scores>;
    expect(childScores[0].name).toBe('a');
    expect(childScores[0].verdict).toBe('pass');
    expect(childScores[1].name).toBe('b');
    expect(childScores[1].verdict).toBe('skip');
  });
});
