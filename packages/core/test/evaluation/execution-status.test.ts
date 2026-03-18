import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';

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
        assertions: [{ text: 'good answer', passed: true }],
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
        assertions: [{ text: 'missed the point', passed: false }],
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
            assertions: [{ text: 'acceptable', passed: true }],
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
            assertions: [{ text: 'barely missed', passed: false }],
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

// ---------------------------------------------------------------------------
// Local repo path validation through orchestrator
// ---------------------------------------------------------------------------

describe('local repo path validation (e2e through runEvalCase)', () => {
  it('returns execution_error when local repo source path does not exist', async () => {
    const testCase: EvalTest = {
      ...baseTestCase,
      id: 'local-path-missing',
      workspace: {
        repos: [
          {
            path: './MyRepo',
            source: {
              type: 'local' as const,
              path: `/tmp/agentv-nonexistent-path-${randomUUID()}`,
            },
          },
        ],
      },
    };

    const provider = new FixedResponseProvider('irrelevant');

    const result = await runEvalCase({
      evalCase: testCase,
      provider,
      target: baseTarget,
      evaluators: highScoreEvaluators,
      evalRunId: randomUUID(),
    });

    expect(result.executionStatus).toBe('execution_error');
    expect(result.failureStage).toBe('repo_setup');
    expect(result.failureReasonCode).toBe('local_path_not_found');
    expect(result.error).toContain('local source path not found');
    expect(result.score).toBe(0);
  });

  it('returns execution_error when local repo source path is empty (unresolved env var)', async () => {
    const testCase: EvalTest = {
      ...baseTestCase,
      id: 'local-path-empty',
      workspace: {
        repos: [
          {
            path: './MyRepo',
            source: {
              type: 'local' as const,
              path: '',
            },
          },
        ],
      },
    };

    const provider = new FixedResponseProvider('irrelevant');

    const result = await runEvalCase({
      evalCase: testCase,
      provider,
      target: baseTarget,
      evaluators: highScoreEvaluators,
      evalRunId: randomUUID(),
    });

    expect(result.executionStatus).toBe('execution_error');
    expect(result.failureStage).toBe('repo_setup');
    expect(result.failureReasonCode).toBe('local_path_not_found');
    expect(result.error).toContain('empty');
    expect(result.score).toBe(0);
  });

  it('proceeds normally when local repo source path exists', async () => {
    const testCase: EvalTest = {
      ...baseTestCase,
      id: 'local-path-valid',
      workspace: {
        repos: [
          {
            path: './MyRepo',
            source: {
              type: 'local' as const,
              path: '/tmp', // /tmp always exists
            },
          },
        ],
      },
    };

    const provider = new FixedResponseProvider('Add structured logging and avoid global state.');

    const result = await runEvalCase({
      evalCase: testCase,
      provider,
      target: baseTarget,
      evaluators: highScoreEvaluators,
      evalRunId: randomUUID(),
    });

    // Should NOT be local_path_not_found — it may fail at materialization (not a git repo)
    // but the path validation itself should pass
    expect(result.failureReasonCode).not.toBe('local_path_not_found');
  });
});
