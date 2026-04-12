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
    it('skip (default): skips downstream when dependency fails', async () => {
      const provider = new FixedProvider('mock', {
        output: [{ role: 'assistant', content: 'answer' }],
      });

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: failingEvaluatorRegistry,
        evalCases: [makeTest('dep'), makeTest('downstream', { depends_on: ['dep'] })],
      });

      expect(results).toHaveLength(2);
      const downstream = results.find((r) => r.testId === 'downstream');
      expect(downstream).toBeDefined();
      expect(downstream?.error).toContain('dependency failed');
      expect(downstream?.error).toContain('dep');
      expect(downstream?.executionStatus).toBe('execution_error');
    });

    it('fail: marks downstream as failed when dependency fails', async () => {
      const provider = new FixedProvider('mock', {
        output: [{ role: 'assistant', content: 'answer' }],
      });

      const results = await runEvaluation({
        testFilePath: 'in-memory.yaml',
        repoRoot: '/tmp',
        target: baseTarget,
        providerFactory: () => provider,
        evaluators: failingEvaluatorRegistry,
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

    it('run: executes downstream even when dependency fails', async () => {
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
        evaluators: failingEvaluatorRegistry,
        evalCases: [
          makeTest('dep'),
          makeTest('downstream', { depends_on: ['dep'], on_dependency_failure: 'run' }),
        ],
      });

      expect(results).toHaveLength(2);
      // Both tests should have been executed
      expect(executionOrder).toContain('dep');
      expect(executionOrder).toContain('downstream');
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
