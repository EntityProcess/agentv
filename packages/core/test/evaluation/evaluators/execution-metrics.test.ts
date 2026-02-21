import { describe, expect, it } from 'bun:test';

import { ExecutionMetricsEvaluator } from '../../../src/evaluation/evaluators/execution-metrics.js';
import type { ResolvedTarget } from '../../../src/evaluation/providers/targets.js';
import type { TraceSummary } from '../../../src/evaluation/trace.js';
import type { EvalTest, ExecutionMetricsEvaluatorConfig } from '../../../src/evaluation/types.js';

const baseTestCase: EvalTest = {
  id: 'metrics-test',
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

function createContext(trace?: TraceSummary) {
  return {
    evalCase: baseTestCase,
    candidate: 'Test answer',
    target: baseTarget,
    provider: baseMockProvider,
    attempt: 0,
    promptInputs: { question: '', guidelines: '' },
    now: new Date(),
    trace,
  };
}

describe('ExecutionMetricsEvaluator', () => {
  describe('max_tool_calls', () => {
    it('passes when tool calls are within limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tool_calls: 10,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 3, Edit: 2 },
          errorCount: 0,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits).toContain('Tool calls 5 <= 10 max');
      expect(result.misses).toHaveLength(0);
    });

    it('fails when tool calls exceed limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tool_calls: 5,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 10,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 6, Edit: 4 },
          errorCount: 0,
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.hits).toHaveLength(0);
      expect(result.misses).toContain('Tool calls 10 > 5 max');
    });
  });

  describe('max_llm_calls', () => {
    it('passes when LLM calls are within limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_llm_calls: 5,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          llmCallCount: 3,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits).toContain('LLM calls 3 <= 5 max');
    });

    it('fails when LLM calls exceed limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_llm_calls: 2,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          llmCallCount: 5,
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('LLM calls 5 > 2 max');
    });
  });

  describe('max_tokens', () => {
    it('passes when token usage is within limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tokens: 2000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          tokenUsage: { input: 800, output: 400 },
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits).toContain('Total tokens 1200 <= 2000 max');
    });

    it('fails when token usage exceeds limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tokens: 1000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          tokenUsage: { input: 800, output: 400 },
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('Total tokens 1200 > 1000 max');
    });
  });

  describe('max_cost_usd', () => {
    it('passes when cost is within budget', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_cost_usd: 0.1,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          costUsd: 0.05,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits).toContain('Cost $0.0500 <= $0.1000 max');
    });

    it('fails when cost exceeds budget', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_cost_usd: 0.05,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          costUsd: 0.1,
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('Cost $0.1000 > $0.0500 max');
    });
  });

  describe('max_duration_ms', () => {
    it('passes when duration is within limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_duration_ms: 5000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          durationMs: 3000,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits).toContain('Duration 3000ms <= 5000ms max');
    });

    it('fails when duration exceeds limit', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_duration_ms: 2000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 3,
          toolNames: ['Read'],
          toolCallsByName: { Read: 3 },
          errorCount: 0,
          durationMs: 5000,
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('Duration 5000ms > 2000ms max');
    });
  });

  describe('target_exploration_ratio', () => {
    it('passes when exploration ratio is within tolerance of target', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        target_exploration_ratio: 0.6,
        exploration_tolerance: 0.2,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 10,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 7, Edit: 3 }, // 70% exploration
          errorCount: 0,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits[0]).toMatch(/Exploration ratio 0\.7.* within tolerance/);
    });

    it('fails when exploration ratio is outside tolerance', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        target_exploration_ratio: 0.8,
        exploration_tolerance: 0.1,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 10,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 5, Edit: 5 }, // 50% exploration
          errorCount: 0,
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses[0]).toMatch(/Exploration ratio 0\.5.* outside tolerance/);
    });

    it('uses default tolerance of 0.2 when not specified', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        target_exploration_ratio: 0.5,
        // No exploration_tolerance specified, should default to 0.2
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 10,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 6, Edit: 4 }, // 60% exploration - within 0.2 of target 0.5
          errorCount: 0,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('combined thresholds', () => {
    it('passes when all specified thresholds are within limits', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tool_calls: 10,
        max_llm_calls: 5,
        max_tokens: 2000,
        max_cost_usd: 0.1,
        max_duration_ms: 5000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 3, Edit: 2 },
          errorCount: 0,
          llmCallCount: 3,
          tokenUsage: { input: 500, output: 300 },
          costUsd: 0.05,
          durationMs: 3000,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits).toHaveLength(5);
      expect(result.misses).toHaveLength(0);
    });

    it('calculates proportional score based on hits and misses', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tool_calls: 10,
        max_llm_calls: 2, // Will fail
        max_tokens: 2000,
        max_cost_usd: 0.01, // Will fail
        max_duration_ms: 5000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 3, Edit: 2 },
          errorCount: 0,
          llmCallCount: 5, // Exceeds max_llm_calls
          tokenUsage: { input: 500, output: 300 },
          costUsd: 0.05, // Exceeds max_cost_usd
          durationMs: 3000,
        }),
      );

      // 3 hits (tool_calls, tokens, duration), 2 misses (llm_calls, cost)
      expect(result.score).toBeCloseTo(0.6); // 3 / 5
      expect(result.verdict).toBe('borderline');
      expect(result.hits).toHaveLength(3);
      expect(result.misses).toHaveLength(2);
    });
  });

  describe('omitted thresholds', () => {
    it('only checks specified thresholds', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tool_calls: 10,
        // Other thresholds not specified
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read', 'Edit'],
          toolCallsByName: { Read: 3, Edit: 2 },
          errorCount: 0,
          // Even though llmCallCount is high, it's not being checked
          llmCallCount: 100,
          tokenUsage: { input: 10000, output: 10000 },
          costUsd: 1.0,
          durationMs: 100000,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits).toHaveLength(1);
      expect(result.hits).toContain('Tool calls 5 <= 10 max');
    });
  });

  describe('missing data handling', () => {
    it('fails when no trace is available', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tool_calls: 10,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(createContext(undefined));

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('No trace summary available');
    });

    it('fails threshold check when required metric is missing', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_cost_usd: 0.1, // Checking cost
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read'],
          toolCallsByName: { Read: 5 },
          errorCount: 0,
          // costUsd is not provided
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('Cost data not available');
    });

    it('fails when tokenUsage is missing for max_tokens check', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tokens: 1000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read'],
          toolCallsByName: { Read: 5 },
          errorCount: 0,
          // tokenUsage is not provided
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('Token usage data not available');
    });

    it('fails when durationMs is missing for max_duration_ms check', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_duration_ms: 5000,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read'],
          toolCallsByName: { Read: 5 },
          errorCount: 0,
          // durationMs is not provided
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('Duration data not available');
    });

    it('fails when llmCallCount is missing for max_llm_calls check', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_llm_calls: 5,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read'],
          toolCallsByName: { Read: 5 },
          errorCount: 0,
          // llmCallCount is not provided
        }),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('LLM call count data not available');
    });
  });

  describe('evaluatorRawRequest', () => {
    it('includes all config values and actual metrics in rawRequest', () => {
      const config: ExecutionMetricsEvaluatorConfig = {
        name: 'test-metrics',
        type: 'execution_metrics',
        max_tool_calls: 10,
        max_tokens: 2000,
        weight: 2.0,
      };

      const evaluator = new ExecutionMetricsEvaluator({ config });
      const result = evaluator.evaluate(
        createContext({
          eventCount: 5,
          toolNames: ['Read'],
          toolCallsByName: { Read: 5 },
          errorCount: 0,
          tokenUsage: { input: 500, output: 300 },
        }),
      );

      expect(result.evaluatorRawRequest).toEqual({
        type: 'execution_metrics',
        config: {
          max_tool_calls: 10,
          max_tokens: 2000,
        },
        actual: {
          tool_calls: 5,
          tokens: 800,
        },
      });
    });
  });
});
