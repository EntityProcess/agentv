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
  dataset: 'test',
  question: 'Test question',
  input: [{ role: 'user', content: 'Test' }],
  input_segments: [{ type: 'text', value: 'Test' }],
  expected_output: [],
  reference_answer: '',
  guideline_paths: [],
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
    promptInputs: { question: '', guidelines: '' },
    now: new Date(),
  };
}

function makeResult(verdict: 'pass' | 'fail' | 'borderline', score: number): EvaluationScore {
  return {
    score,
    verdict,
    hits: verdict === 'pass' ? ['passed'] : [],
    misses: verdict === 'fail' ? ['failed'] : [],
    expectedAspectCount: 1,
    reasoning: `verdict: ${verdict}`,
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
        evaluators: [
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
        evaluators: [
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
        evaluators: [
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
        evaluators: [
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
        evaluators: [
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
    expect(result.reasoning).toContain('borderline');
    expect(result.reasoning).toContain('1 borderline evaluator(s) counted as passing');
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
        evaluators: [
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
    expect(result.reasoning).not.toContain('Warning');
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
        evaluators: [
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
        evaluators: [
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
        evaluators: [
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
