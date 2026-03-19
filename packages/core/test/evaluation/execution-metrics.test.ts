import { describe, expect, it } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodeEvaluator } from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import {
  type TraceComputeResult,
  type TraceSummary,
  avgToolDurationMs,
  explorationRatio,
  mergeExecutionMetrics,
  tokensPerTool,
} from '../../src/evaluation/trace.js';
import type { EvalTest } from '../../src/evaluation/types.js';

describe('Execution Metrics', () => {
  describe('explorationRatio', () => {
    it('returns undefined when there are no tool calls', () => {
      const summary: TraceSummary = {
        eventCount: 0,
        toolCalls: {},
        errorCount: 0,
      };

      expect(explorationRatio(summary)).toBeUndefined();
    });

    it('returns 1.0 when all calls are exploration tools', () => {
      const summary: TraceSummary = {
        eventCount: 5,
        toolCalls: { Read: 2, Grep: 2, Glob: 1 },
        errorCount: 0,
      };

      expect(explorationRatio(summary)).toBe(1.0);
    });

    it('returns 0.0 when no calls are exploration tools', () => {
      const summary: TraceSummary = {
        eventCount: 3,
        toolCalls: { Edit: 1, Write: 1, Bash: 1 },
        errorCount: 0,
      };

      expect(explorationRatio(summary)).toBe(0.0);
    });

    it('returns correct ratio for mixed tool usage', () => {
      const summary: TraceSummary = {
        eventCount: 10,
        toolCalls: { Read: 4, Grep: 2, Edit: 3, Write: 1 },
        errorCount: 0,
      };

      // 6 exploration calls (Read: 4, Grep: 2) out of 10
      expect(explorationRatio(summary)).toBe(0.6);
    });

    it('accepts custom exploration tools list', () => {
      const summary: TraceSummary = {
        eventCount: 6,
        toolCalls: { CustomTool: 3, Edit: 2, OtherTool: 1 },
        errorCount: 0,
      };

      // 4 calls (CustomTool: 3, OtherTool: 1) are exploration with custom list
      expect(explorationRatio(summary, ['CustomTool', 'OtherTool'])).toBeCloseTo(4 / 6);
    });
  });

  describe('tokensPerTool', () => {
    it('returns undefined when tokenUsage is not available', () => {
      const summary: TraceSummary = {
        eventCount: 5,
        toolCalls: { Read: 5 },
        errorCount: 0,
      };

      expect(tokensPerTool(summary)).toBeUndefined();
    });

    it('returns undefined when there are no tool calls', () => {
      const summary: TraceSummary = {
        eventCount: 0,
        toolCalls: {},
        errorCount: 0,
      };

      expect(tokensPerTool(summary, { input: 1000, output: 500 })).toBeUndefined();
    });

    it('computes correct tokens per tool', () => {
      const summary: TraceSummary = {
        eventCount: 5,
        toolCalls: { Read: 3, Edit: 2 },
        errorCount: 0,
      };

      // Total tokens: 1500, divided by 5 tool calls = 300 tokens per tool
      expect(tokensPerTool(summary, { input: 1000, output: 500 })).toBe(300);
    });

    it('handles cached tokens in total calculation', () => {
      const summary: TraceSummary = {
        eventCount: 4,
        toolCalls: { Read: 4 },
        errorCount: 0,
      };

      // Total tokens: 800 + 400 = 1200 (cached not added to total)
      expect(tokensPerTool(summary, { input: 800, output: 400, cached: 200 })).toBe(300);
    });
  });

  describe('avgToolDurationMs', () => {
    it('returns undefined when toolDurations is not available', () => {
      const summary: TraceSummary = {
        eventCount: 5,
        toolCalls: { Read: 5 },
        errorCount: 0,
      };

      expect(avgToolDurationMs(summary)).toBeUndefined();
    });

    it('returns undefined when toolDurations is empty', () => {
      const summary: TraceSummary = {
        eventCount: 0,
        toolCalls: {},
        errorCount: 0,
        toolDurations: {},
      };

      expect(avgToolDurationMs(summary)).toBeUndefined();
    });

    it('computes correct average duration', () => {
      const summary: TraceSummary = {
        eventCount: 4,
        toolCalls: { Read: 3, Edit: 1 },
        errorCount: 0,
        toolDurations: {
          Read: [100, 150, 200], // avg: 150
          Edit: [50], // avg: 50
        },
      };

      // Total duration: 100 + 150 + 200 + 50 = 500ms
      // Total calls: 4
      // Average: 125ms
      expect(avgToolDurationMs(summary)).toBe(125);
    });

    it('handles single tool with multiple calls', () => {
      const summary: TraceSummary = {
        eventCount: 3,
        toolCalls: { Grep: 3 },
        errorCount: 0,
        toolDurations: {
          Grep: [100, 200, 300],
        },
      };

      expect(avgToolDurationMs(summary)).toBe(200);
    });
  });

  describe('mergeExecutionMetrics', () => {
    const baseComputed: TraceComputeResult = {
      trace: {
        eventCount: 5,
        toolCalls: { Read: 3, Edit: 2 },
        errorCount: 0,
      },
    };

    it('returns the same result when no metrics provided', () => {
      const result = mergeExecutionMetrics(baseComputed);

      expect(result).toBe(baseComputed);
    });

    it('returns the same result when metrics is undefined', () => {
      const result = mergeExecutionMetrics(baseComputed, undefined);

      expect(result).toBe(baseComputed);
    });

    it('merges tokenUsage into result', () => {
      const result = mergeExecutionMetrics(baseComputed, {
        tokenUsage: { input: 1000, output: 500 },
      });

      expect(result.trace.eventCount).toBe(5);
      expect(result.trace.toolCalls).toEqual({ Read: 3, Edit: 2 });
      expect(result.tokenUsage).toEqual({ input: 1000, output: 500 });
      expect(result.costUsd).toBeUndefined();
      expect(result.durationMs).toBeUndefined();
    });

    it('merges all metrics into result', () => {
      const result = mergeExecutionMetrics(baseComputed, {
        tokenUsage: { input: 1000, output: 500, cached: 100 },
        costUsd: 0.05,
        durationMs: 12000,
      });

      expect(result.trace.eventCount).toBe(5);
      expect(result.trace.toolCalls).toEqual({ Read: 3, Edit: 2 });
      expect(result.tokenUsage).toEqual({ input: 1000, output: 500, cached: 100 });
      expect(result.costUsd).toBe(0.05);
      expect(result.durationMs).toBe(12000);
    });

    it('preserves existing trace fields', () => {
      const computedWithError: TraceComputeResult = {
        trace: {
          ...baseComputed.trace,
          errorCount: 2,
        },
      };

      const result = mergeExecutionMetrics(computedWithError, {
        costUsd: 0.1,
      });

      expect(result.trace.errorCount).toBe(2);
      expect(result.costUsd).toBe(0.1);
    });

    it('does not mutate the original result', () => {
      const result = mergeExecutionMetrics(baseComputed, {
        tokenUsage: { input: 1000, output: 500 },
      });

      expect(baseComputed.tokenUsage).toBeUndefined();
      expect(result.tokenUsage).toEqual({ input: 1000, output: 500 });
    });
  });
});

describe('Code Grader Metrics Integration', () => {
  const baseTestCase: EvalTest = {
    id: 'metrics-test',
    eval_set: 'test',
    question: 'Test question',
    input: [{ role: 'user', content: 'Test' }],
    input_segments: [{ type: 'text', value: 'Test' }],
    expected_output: [],
    reference_answer: '',
    guideline_paths: [],
    file_paths: [],
    criteria: 'Test outcome',
    evaluator: 'code-grader',
  };

  const baseTarget: ResolvedTarget = {
    kind: 'mock',
    name: 'mock',
    config: { response: '{}' },
  };

  it('passes trace to code-grader scripts', async () => {
    // Use external script file for cross-platform compatibility
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-trace-summary.cjs')];

    const evaluator = new CodeEvaluator({ command: script });

    const trace: TraceSummary = {
      eventCount: 3,
      toolCalls: { Read: 2, Edit: 1 },
      errorCount: 0,
    };

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Test answer',
      target: baseTarget,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      trace,
      tokenUsage: { input: 1000, output: 500 },
      costUsd: 0.005,
      durationMs: 2500,
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
    expect(result.assertions.filter((a) => a.passed).map((a) => a.text)).toContain(
      'eventCount present',
    );
    expect(result.assertions.filter((a) => a.passed).map((a) => a.text)).toContain(
      'tokenUsage present',
    );
    expect(result.assertions.filter((a) => a.passed).map((a) => a.text)).toContain(
      'costUsd present',
    );
  });

  it('handles missing trace gracefully', async () => {
    // Use external script file for cross-platform compatibility
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const script = ['node', join(__dirname, '../fixtures/test-no-trace-summary.cjs')];

    const evaluator = new CodeEvaluator({ command: script });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Test answer',
      target: baseTarget,
      attempt: 0,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      // No trace provided
    });

    expect(result.score).toBe(1);
    expect(result.assertions.filter((a) => a.passed).map((a) => a.text)).toContain(
      'Correctly handled missing summary',
    );
  });
});
