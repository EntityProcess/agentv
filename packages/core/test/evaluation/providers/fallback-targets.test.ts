/**
 * Tests for fallback_targets feature.
 *
 * When a primary target fails with provider errors after exhausting retries,
 * the runner tries fallback targets in order. The result records which target
 * actually served the response via the `targetUsed` field.
 */
import { describe, expect, it } from 'bun:test';

import { runEvalCase } from '../../../src/evaluation/orchestrator.js';
import { resolveTargetDefinition } from '../../../src/evaluation/providers/targets.js';
import type { ResolvedTarget } from '../../../src/evaluation/providers/targets.js';
import type { Provider, ProviderResponse } from '../../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../../src/evaluation/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResponse(content: string): ProviderResponse {
  return {
    output: [{ role: 'assistant', content }],
  };
}

class FailingProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;

  constructor(targetName: string) {
    this.id = `failing:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(): Promise<ProviderResponse> {
    const error = new Error('Service Unavailable') as Error & { status: number };
    error.status = 503;
    throw error;
  }
}

class SuccessProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;
  private readonly response: ProviderResponse;
  invoked = false;

  constructor(targetName: string, content = 'ok') {
    this.id = `success:${targetName}`;
    this.targetName = targetName;
    this.response = makeResponse(content);
  }

  async invoke(): Promise<ProviderResponse> {
    this.invoked = true;
    return this.response;
  }
}

const MOCK_EVAL_CASE: EvalTest = {
  id: 'test-1',
  question: 'What is 1+1?',
  input: [{ role: 'user', content: 'What is 1+1?' }],
  expected_output: [],
  file_paths: [],
  criteria: 'Answer correctly',
};

const MOCK_TARGET: ResolvedTarget = {
  kind: 'mock',
  name: 'primary',
  config: { response: 'ok' },
  fallbackTargets: ['fallback-a', 'fallback-b'],
};

const MOCK_TARGET_NO_FALLBACK: ResolvedTarget = {
  kind: 'mock',
  name: 'primary',
  config: { response: 'ok' },
};

function makeGraderResponse(): ProviderResponse {
  return {
    output: [
      {
        role: 'assistant',
        content: JSON.stringify({
          score: 10,
          pass: true,
          criteria: [{ id: 'main', score: 10, satisfied: true }],
        }),
      },
    ],
  };
}

class StubGrader implements Provider {
  readonly id = 'grader:stub';
  readonly kind = 'mock' as const;
  readonly targetName = 'grader';

  async invoke(): Promise<ProviderResponse> {
    return makeGraderResponse();
  }
}

// Minimal evaluator map required by runEvalCase
const evaluators = {
  'llm-grader': {
    kind: 'llm-grader',
    async evaluate() {
      return {
        score: 1.0,
        verdict: 'pass' as const,
        assertions: [{ text: 'Passed', passed: true }],
        expectedAspectCount: 1,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// resolveTargetDefinition tests
// ---------------------------------------------------------------------------

describe('resolveTargetDefinition - fallback_targets', () => {
  const env = {
    TEST_KEY: 'sk-test-key',
    TEST_MODEL: 'gpt-4o-mini',
  };

  it('resolves fallback_targets from snake_case YAML field', () => {
    const definition = {
      name: 'test-openai',
      provider: 'openai',
      api_key: '${{ TEST_KEY }}',
      model: '${{ TEST_MODEL }}',
      fallback_targets: ['azure-llm', 'gemini-flash'],
    };

    const resolved = resolveTargetDefinition(definition, env);
    expect(resolved.fallbackTargets).toEqual(['azure-llm', 'gemini-flash']);
  });

  it('rejects fallbackTargets camelCase field', () => {
    const definition = {
      name: 'test-openai',
      provider: 'openai',
      api_key: '${{ TEST_KEY }}',
      model: '${{ TEST_MODEL }}',
      fallbackTargets: ['backup-1'],
    };

    expect(() => resolveTargetDefinition(definition, env)).toThrow(
      /fallbackTargets.*fallback_targets/i,
    );
  });

  it('omits fallbackTargets when not specified', () => {
    const definition = {
      name: 'test-openai',
      provider: 'openai',
      api_key: '${{ TEST_KEY }}',
      model: '${{ TEST_MODEL }}',
    };

    const resolved = resolveTargetDefinition(definition, env);
    expect(resolved.fallbackTargets).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Orchestrator fallback tests
// ---------------------------------------------------------------------------

describe('runEvalCase - fallback targets', () => {
  it('uses fallback provider when primary fails', async () => {
    const primary = new FailingProvider('primary');
    const fallbackA = new SuccessProvider('fallback-a', 'from fallback-a');

    const result = await runEvalCase({
      evalCase: MOCK_EVAL_CASE,
      provider: primary,
      target: MOCK_TARGET,
      evaluators,
      maxRetries: 0, // No retries on primary, go straight to fallback
      targetResolver: (name: string) => {
        if (name === 'fallback-a') return fallbackA;
        return undefined;
      },
      availableTargets: ['primary', 'fallback-a', 'fallback-b'],
    });

    expect(result.targetUsed).toBe('fallback-a');
    expect(fallbackA.invoked).toBe(true);
    // Should not be an error result — fallback succeeded
    expect(result.error).toBeUndefined();
  });

  it('skips unavailable fallback and uses next one', async () => {
    const primary = new FailingProvider('primary');
    const fallbackB = new SuccessProvider('fallback-b', 'from fallback-b');

    const result = await runEvalCase({
      evalCase: MOCK_EVAL_CASE,
      provider: primary,
      target: MOCK_TARGET,
      evaluators,
      maxRetries: 0,
      targetResolver: (name: string) => {
        // fallback-a is not resolvable
        if (name === 'fallback-b') return fallbackB;
        return undefined;
      },
      availableTargets: ['primary', 'fallback-b'],
    });

    expect(result.targetUsed).toBe('fallback-b');
    expect(fallbackB.invoked).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when primary and all fallbacks fail', async () => {
    const primary = new FailingProvider('primary');
    const fallbackA = new FailingProvider('fallback-a');
    const fallbackB = new FailingProvider('fallback-b');

    const result = await runEvalCase({
      evalCase: MOCK_EVAL_CASE,
      provider: primary,
      target: MOCK_TARGET,
      evaluators,
      maxRetries: 0,
      targetResolver: (name: string) => {
        if (name === 'fallback-a') return fallbackA;
        if (name === 'fallback-b') return fallbackB;
        return undefined;
      },
      availableTargets: ['primary', 'fallback-a', 'fallback-b'],
    });

    expect(result.error).toBeDefined();
    expect(result.executionStatus).toBe('execution_error');
  });

  it('does not use fallback when primary succeeds', async () => {
    const primary = new SuccessProvider('primary', 'from primary');
    const fallbackA = new SuccessProvider('fallback-a', 'from fallback-a');

    const result = await runEvalCase({
      evalCase: MOCK_EVAL_CASE,
      provider: primary,
      target: MOCK_TARGET,
      evaluators,
      maxRetries: 0,
      targetResolver: (name: string) => {
        if (name === 'fallback-a') return fallbackA;
        return undefined;
      },
      availableTargets: ['primary', 'fallback-a'],
    });

    expect(result.targetUsed).toBeUndefined();
    expect(fallbackA.invoked).toBe(false);
    expect(result.target).toBe('primary');
  });

  it('target field always shows primary target name', async () => {
    const primary = new FailingProvider('primary');
    const fallbackA = new SuccessProvider('fallback-a', 'from fallback-a');

    const result = await runEvalCase({
      evalCase: MOCK_EVAL_CASE,
      provider: primary,
      target: MOCK_TARGET,
      evaluators,
      maxRetries: 0,
      targetResolver: (name: string) => {
        if (name === 'fallback-a') return fallbackA;
        return undefined;
      },
      availableTargets: ['primary', 'fallback-a'],
    });

    // target always shows the primary target name
    expect(result.target).toBe('primary');
    // targetUsed shows which fallback actually served the response
    expect(result.targetUsed).toBe('fallback-a');
  });

  it('does not attempt fallback when no fallback_targets configured', async () => {
    const primary = new FailingProvider('primary');
    const fallbackA = new SuccessProvider('fallback-a', 'from fallback-a');

    const result = await runEvalCase({
      evalCase: MOCK_EVAL_CASE,
      provider: primary,
      target: MOCK_TARGET_NO_FALLBACK,
      evaluators,
      maxRetries: 0,
      targetResolver: (name: string) => {
        if (name === 'fallback-a') return fallbackA;
        return undefined;
      },
      availableTargets: ['primary', 'fallback-a'],
    });

    expect(result.error).toBeDefined();
    expect(fallbackA.invoked).toBe(false);
  });

  it('does not attempt fallback when targetResolver is not provided', async () => {
    const primary = new FailingProvider('primary');

    const result = await runEvalCase({
      evalCase: MOCK_EVAL_CASE,
      provider: primary,
      target: MOCK_TARGET,
      evaluators,
      maxRetries: 0,
      // No targetResolver — cannot resolve fallback names
    });

    expect(result.error).toBeDefined();
    expect(result.executionStatus).toBe('execution_error');
  });
});
