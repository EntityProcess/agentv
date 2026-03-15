import { describe, expect, it } from 'bun:test';

import { runEvalCase } from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { Provider, ProviderResponse } from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

class ErrorProvider implements Provider {
  readonly id = 'mock:error';
  readonly kind = 'mock' as const;
  readonly targetName = 'error-target';

  async invoke(): Promise<ProviderResponse> {
    throw new Error('Provider failed');
  }
}

class FixedResponseProvider implements Provider {
  readonly id = 'mock:fixed';
  readonly kind = 'mock' as const;
  readonly targetName = 'fixed-target';

  constructor(private readonly response: string) {}

  async invoke(): Promise<ProviderResponse> {
    return {
      output: [{ role: 'assistant', content: this.response }],
    };
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseTestCase: EvalTest = {
  id: 'exec-status-1',
  dataset: 'test-dataset',
  question: 'Explain logging improvements',
  input: [{ role: 'user', content: 'Explain logging improvements' }],
  input_segments: [{ type: 'text', value: 'Explain logging improvements' }],
  expected_output: [],
  reference_answer: '- add structured logging\n- avoid global state',
  guideline_paths: [],
  file_paths: [],
  criteria: 'Logging improved',
  evaluator: 'llm-grader',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

/** Returns a score >= 0.8 → executionStatus 'ok' */
const highScoreEvaluators = {
  'llm-grader': {
    kind: 'llm-grader',
    async evaluate() {
      return {
        score: 0.9,
        verdict: 'pass' as const,
        hits: ['good answer'],
        misses: [],
        expectedAspectCount: 1,
      };
    },
  },
};

/** Returns a score < 0.8 → executionStatus 'quality_failure' */
const lowScoreEvaluators = {
  'llm-grader': {
    kind: 'llm-grader',
    async evaluate() {
      return {
        score: 0.3,
        verdict: 'fail' as const,
        hits: [],
        misses: ['missed the point'],
        expectedAspectCount: 1,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('execution status classification', () => {
  it('classifies provider errors as execution_error with agent stage', async () => {
    const provider = new ErrorProvider();

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: highScoreEvaluators,
    });

    expect(result.executionStatus).toBe('execution_error');
    expect(result.failureStage).toBe('agent');
    expect(result.failureReasonCode).toBe('provider_error');
    expect(result.executionError).toBeDefined();
    expect(result.executionError?.message).toContain('Provider failed');
    expect(result.executionError?.stage).toBe('agent');
    // Backward compat: error field still set
    expect(result.error).toBeDefined();
    expect(result.score).toBe(0);
  });

  it('classifies high-scoring results as ok', async () => {
    const provider = new FixedResponseProvider('Add structured logging and avoid global state.');

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: highScoreEvaluators,
    });

    expect(result.executionStatus).toBe('ok');
    expect(result.failureStage).toBeUndefined();
    expect(result.failureReasonCode).toBeUndefined();
    expect(result.executionError).toBeUndefined();
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('classifies low-scoring results as quality_failure', async () => {
    const provider = new FixedResponseProvider('I have no idea about logging.');

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: lowScoreEvaluators,
    });

    expect(result.executionStatus).toBe('quality_failure');
    expect(result.failureStage).toBeUndefined();
    expect(result.failureReasonCode).toBeUndefined();
    expect(result.executionError).toBeUndefined();
    expect(result.score).toBeLessThan(0.8);
  });

  it('preserves backward-compatible error field on execution errors', async () => {
    const provider = new ErrorProvider();

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: highScoreEvaluators,
    });

    // Both old and new fields are set
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.executionStatus).toBe('execution_error');
    expect(result.executionError).toBeDefined();
    expect(result.executionError?.message).toBe(result.error);
  });

  it('sets executionStatus to ok at exact 0.8 threshold', async () => {
    const thresholdEvaluators = {
      'llm-grader': {
        kind: 'llm-grader',
        async evaluate() {
          return {
            score: 0.8,
            verdict: 'pass' as const,
            hits: ['acceptable'],
            misses: [],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const provider = new FixedResponseProvider('Adequate answer.');

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: thresholdEvaluators,
    });

    expect(result.executionStatus).toBe('ok');
    expect(result.score).toBe(0.8);
  });

  it('sets executionStatus to quality_failure just below threshold', async () => {
    const belowThresholdEvaluators = {
      'llm-grader': {
        kind: 'llm-grader',
        async evaluate() {
          return {
            score: 0.79,
            verdict: 'fail' as const,
            hits: [],
            misses: ['barely missed'],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const provider = new FixedResponseProvider('Almost adequate answer.');

    const result = await runEvalCase({
      evalCase: baseTestCase,
      provider,
      target: baseTarget,
      evaluators: belowThresholdEvaluators,
    });

    expect(result.executionStatus).toBe('quality_failure');
    expect(result.score).toBe(0.79);
  });
});
