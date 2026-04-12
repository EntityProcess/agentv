import { describe, expect, it } from 'bun:test';

import { runEvaluation } from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type {
  Provider,
  ProviderRequest,
  ProviderResponse,
} from '../../src/evaluation/providers/types.js';
import type { DependencyFailurePolicy, EvalTest } from '../../src/evaluation/types.js';

/**
 * Mock provider returning a fixed response.
 */
class FixedProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;

  constructor(
    targetName: string,
    private readonly response: ProviderResponse,
  ) {
    this.id = `mock:${targetName}`;
    this.targetName = targetName;
  }

  async invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    return this.response;
  }
}

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

const passingEvaluatorRegistry = {
  'llm-grader': {
    kind: 'llm-grader',
    async evaluate() {
      return {
        score: 0.9,
        verdict: 'pass' as const,
        assertions: [{ text: 'ok', passed: true }],
        expectedAspectCount: 1,
      };
    },
  },
};

const failingEvaluatorRegistry = {
  'llm-grader': {
    kind: 'llm-grader',
    async evaluate() {
      return {
        score: 0.2,
        verdict: 'fail' as const,
        assertions: [{ text: 'nope', passed: false }],
        expectedAspectCount: 1,
      };
    },
  },
};

function makeTest(
  id: string,
  opts?: { depends_on?: string[]; on_dependency_failure?: DependencyFailurePolicy },
): EvalTest {
  return {
    id,
    suite: 'dep-test',
    question: `Task ${id}`,
    input: [{ role: 'user', content: `Do ${id}` }],
    expected_output: [],
    file_paths: [],
    criteria: `Criteria for ${id}`,
    evaluator: 'llm-grader',
    ...(opts?.depends_on ? { depends_on: opts.depends_on } : {}),
    ...(opts?.on_dependency_failure ? { on_dependency_failure: opts.on_dependency_failure } : {}),
  };
}

describe('dependency-aware scheduling', () => {
  describe('backward compatibility', () => {
    it('tests without depends_on run exactly as before', async () => {
      const provider = new FixedProvider('mock', {
        output: [{ role: 'assistant', content: 'answer' }],
      });

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: passingEvaluatorRegistry,
        evalCases: [makeTest('a'), makeTest('b'), makeTest('c')],
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.score > 0)).toBe(true);
    });
  });

  describe('DAG validation', () => {
    it('rejects circular dependencies', async () => {
      const provider = new FixedProvider('mock', {
        output: [{ role: 'assistant', content: 'answer' }],
      });

      await expect(
        runEvaluation({
          testFilePath: 'in-memory.yaml',
          repoRoot: '/tmp',
          target: baseTarget,
          providerFactory: () => provider,
          evaluators: undefined,
          evalCases: [makeTest('a', { depends_on: ['b'] }), makeTest('b', { depends_on: ['a'] })],
        }),
      ).rejects.toThrow(/[Cc]ircular dependency/);
    });

    it('rejects references to missing test IDs', async () => {
      const provider = new FixedProvider('mock', {
        output: [{ role: 'assistant', content: 'answer' }],
      });

      await expect(
        runEvaluation({
          testFilePath: 'in-memory.yaml',
          repoRoot: '/tmp',
          target: baseTarget,
          providerFactory: () => provider,
          evaluators: undefined,
          evalCases: [makeTest('a', { depends_on: ['nonexistent'] })],
        }),
      ).rejects.toThrow(/no test with that ID/);
    });

    it('rejects self-dependency', async () => {
      const provider = new FixedProvider('mock', {
        output: [{ role: 'assistant', content: 'answer' }],
      });

      await expect(
        runEvaluation({
          testFilePath: 'in-memory.yaml',
          repoRoot: '/tmp',
          target: baseTarget,
          providerFactory: () => provider,
          evaluators: undefined,
          evalCases: [makeTest('a', { depends_on: ['a'] })],
        }),
      ).rejects.toThrow(/depends on itself/);
    });
  });

  describe('wave scheduling', () => {
    it('runs independent tests in parallel, dependents after', async () => {
      const executionOrder: string[] = [];

      const trackingProvider: Provider = {
        id: 'mock:tracking',
        kind: 'mock' as const,
        targetName: 'tracking',
        async invoke(request: ProviderRequest): Promise<ProviderResponse> {
          const testId = request.evalCaseId ?? 'unknown';
          executionOrder.push(testId);
          // Add small delay to check parallel execution within waves
          await new Promise((r) => setTimeout(r, 10));
          return { output: [{ role: 'assistant', content: `Output for ${testId}` }] };
        },
      };

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => trackingProvider,
        evaluators: passingEvaluatorRegistry,
        evalCases: [
          makeTest('backend'),
          makeTest('frontend'),
          makeTest('integration', { depends_on: ['backend', 'frontend'] }),
        ],
      });

      expect(results).toHaveLength(3);
      // Integration must run after both backend and frontend
      const integrationIdx = executionOrder.indexOf('integration');
      const backendIdx = executionOrder.indexOf('backend');
      const frontendIdx = executionOrder.indexOf('frontend');
      expect(integrationIdx).toBeGreaterThan(backendIdx);
      expect(integrationIdx).toBeGreaterThan(frontendIdx);
    });

    it('supports multi-level dependency chains', async () => {
      const executionOrder: string[] = [];

      const trackingProvider: Provider = {
        id: 'mock:tracking',
        kind: 'mock' as const,
        targetName: 'tracking',
        async invoke(request: ProviderRequest): Promise<ProviderResponse> {
          const testId = request.evalCaseId ?? 'unknown';
          executionOrder.push(testId);
          return { output: [{ role: 'assistant', content: 'ok' }] };
        },
      };

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => trackingProvider,
        evaluators: passingEvaluatorRegistry,
        evalCases: [
          makeTest('level-0a'),
          makeTest('level-0b'),
          makeTest('level-1', { depends_on: ['level-0a'] }),
          makeTest('level-2', { depends_on: ['level-1', 'level-0b'] }),
        ],
      });

      expect(results).toHaveLength(4);
      // Verify ordering: level-2 must be last
      const idx2 = executionOrder.indexOf('level-2');
      const idx1 = executionOrder.indexOf('level-1');
      const idx0a = executionOrder.indexOf('level-0a');
      const idx0b = executionOrder.indexOf('level-0b');
      expect(idx1).toBeGreaterThan(idx0a);
      expect(idx2).toBeGreaterThan(idx1);
      expect(idx2).toBeGreaterThan(idx0b);
    });
  });

  describe('on_dependency_failure policies', () => {
    // Use a provider that throws for 'dep' to produce an execution_error
    const errorOnDepProvider: Provider = {
      id: 'mock:error-on-dep',
      kind: 'mock' as const,
      targetName: 'error-on-dep',
      async invoke(request: ProviderRequest): Promise<ProviderResponse> {
        if (request.evalCaseId === 'dep') {
          throw new Error('Simulated provider crash');
        }
        return { output: [{ role: 'assistant', content: 'ok' }] };
      },
    };

    it('skip (default): skips downstream when dependency has execution error', async () => {
      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => errorOnDepProvider,
        evaluators: passingEvaluatorRegistry,
        evalCases: [makeTest('dep'), makeTest('downstream', { depends_on: ['dep'] })],
      });

      expect(results).toHaveLength(2);
      const downstream = results.find((r) => r.testId === 'downstream');
      expect(downstream).toBeDefined();
      expect(downstream?.error).toContain('dependency failed');
      expect(downstream?.error).toContain('dep');
      expect(downstream?.executionStatus).toBe('execution_error');
    });

    it('fail: marks downstream as failed when dependency has execution error', async () => {
      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => errorOnDepProvider,
        evaluators: passingEvaluatorRegistry,
        evalCases: [
          makeTest('dep'),
          makeTest('downstream', { depends_on: ['dep'], on_dependency_failure: 'fail' }),
        ],
      });

      expect(results).toHaveLength(2);
      const downstream = results.find((r) => r.testId === 'downstream');
      expect(downstream).toBeDefined();
      expect(downstream?.error).toContain('Failed: dependency failed');
      expect(downstream?.score).toBe(0);
    });

    it('run: executes downstream even when dependency has execution error', async () => {
      const executionOrder: string[] = [];

      const trackingErrorProvider: Provider = {
        id: 'mock:tracking-error',
        kind: 'mock' as const,
        targetName: 'tracking-error',
        async invoke(request: ProviderRequest): Promise<ProviderResponse> {
          const testId = request.evalCaseId ?? 'unknown';
          executionOrder.push(testId);
          if (testId === 'dep') {
            throw new Error('Simulated provider crash');
          }
          return { output: [{ role: 'assistant', content: 'ok' }] };
        },
      };

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => trackingErrorProvider,
        evaluators: passingEvaluatorRegistry,
        evalCases: [
          makeTest('dep'),
          makeTest('downstream', { depends_on: ['dep'], on_dependency_failure: 'run' }),
        ],
      });

      expect(results).toHaveLength(2);
      // Both tests should have been executed (dep threw but downstream runs anyway)
      expect(executionOrder).toContain('dep');
      expect(executionOrder).toContain('downstream');
    });
  });

  describe('transitive dependency cascade', () => {
    it('cascades skip across A -> B -> C when A has execution error', async () => {
      // Provider that throws for test 'a' (execution error)
      const errorProvider: Provider = {
        id: 'mock:error',
        kind: 'mock' as const,
        targetName: 'error',
        async invoke(request: ProviderRequest): Promise<ProviderResponse> {
          if (request.evalCaseId === 'a') {
            throw new Error('Simulated provider crash');
          }
          return { output: [{ role: 'assistant', content: 'ok' }] };
        },
      };

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => errorProvider,
        evaluators: passingEvaluatorRegistry,
        evalCases: [
          makeTest('a'),
          makeTest('b', { depends_on: ['a'] }),
          makeTest('c', { depends_on: ['b'] }),
        ],
      });

      expect(results).toHaveLength(3);
      const resultA = results.find((r) => r.testId === 'a');
      const resultB = results.find((r) => r.testId === 'b');
      const resultC = results.find((r) => r.testId === 'c');
      // A has execution error (provider threw)
      expect(resultA?.executionStatus).toBe('execution_error');
      // B is skipped because A failed
      expect(resultB?.error).toContain('dependency failed');
      expect(resultB?.executionStatus).toBe('execution_error');
      // C is skipped because B was skipped (cascade)
      expect(resultC?.error).toContain('dependency failed');
      expect(resultC?.executionStatus).toBe('execution_error');
    });
  });

  describe('quality_failure does NOT trigger dependency failure', () => {
    it('runs downstream even when dependency scores below threshold', async () => {
      const executionOrder: string[] = [];
      const trackingProvider: Provider = {
        id: 'mock:tracking',
        kind: 'mock' as const,
        targetName: 'tracking',
        async invoke(request: ProviderRequest): Promise<ProviderResponse> {
          executionOrder.push(request.evalCaseId ?? 'unknown');
          return { output: [{ role: 'assistant', content: 'ok' }] };
        },
      };

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => trackingProvider,
        evaluators: failingEvaluatorRegistry, // scores 0.2 — quality_failure, not execution_error
        evalCases: [
          makeTest('dep'),
          makeTest('downstream', { depends_on: ['dep'] }), // default: skip
        ],
      });

      expect(results).toHaveLength(2);
      // Both tests should execute — quality failure is NOT a dependency failure
      expect(executionOrder).toContain('dep');
      expect(executionOrder).toContain('downstream');
      // dep scored poorly but ran fine
      const depResult = results.find((r) => r.testId === 'dep');
      expect(depResult?.executionStatus).toBe('quality_failure');
      // downstream ran (not skipped)
      const downstreamResult = results.find((r) => r.testId === 'downstream');
      expect(downstreamResult?.error).toBeUndefined();
    });
  });

  describe('dependency_results in evaluator context', () => {
    it('passes dependency results to downstream evaluator', async () => {
      let capturedContext: unknown = undefined;

      const contextCapturingRegistry = {
        'llm-grader': {
          kind: 'llm-grader',
          async evaluate(ctx: unknown) {
            capturedContext = ctx;
            return {
              score: 0.9,
              verdict: 'pass' as const,
              assertions: [{ text: 'ok', passed: true }],
              expectedAspectCount: 1,
            };
          },
        },
      };

      const provider = new FixedProvider('mock', {
        output: [{ role: 'assistant', content: 'answer' }],
      });

      await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: contextCapturingRegistry,
        evalCases: [makeTest('dep'), makeTest('downstream', { depends_on: ['dep'] })],
      });

      // The last evaluation context should be for 'downstream' and include dependencyResults
      const ctx = capturedContext as {
        evalCase: EvalTest;
        dependencyResults?: Record<string, unknown>;
      };
      expect(ctx.evalCase.id).toBe('downstream');
      expect(ctx.dependencyResults).toBeDefined();
      expect(ctx.dependencyResults?.dep).toBeDefined();
      expect((ctx.dependencyResults?.dep as { score: number }).score).toBe(0.9);
      expect((ctx.dependencyResults?.dep as { status: string }).status).toBe('passed');
    });
  });
});
