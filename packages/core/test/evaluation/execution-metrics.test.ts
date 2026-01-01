import { describe, expect, it } from 'bun:test';

import {
  type TraceSummary,
  avgToolDurationMs,
  explorationRatio,
  mergeExecutionMetrics,
  tokensPerTool,
} from '../../src/evaluation/trace.js';

describe('Execution Metrics', () => {
  describe('explorationRatio', () => {
    it('returns undefined when there are no tool calls', () => {
      const summary: TraceSummary = {
        eventCount: 0,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
      };

      expect(explorationRatio(summary)).toBeUndefined();
    });

    it('returns 1.0 when all calls are exploration tools', () => {
      const summary: TraceSummary = {
        eventCount: 5,
        toolNames: ['Read', 'Grep', 'Glob'],
        toolCallsByName: { Read: 2, Grep: 2, Glob: 1 },
        errorCount: 0,
      };

      expect(explorationRatio(summary)).toBe(1.0);
    });

    it('returns 0.0 when no calls are exploration tools', () => {
      const summary: TraceSummary = {
        eventCount: 3,
        toolNames: ['Edit', 'Write', 'Bash'],
        toolCallsByName: { Edit: 1, Write: 1, Bash: 1 },
        errorCount: 0,
      };

      expect(explorationRatio(summary)).toBe(0.0);
    });

    it('returns correct ratio for mixed tool usage', () => {
      const summary: TraceSummary = {
        eventCount: 10,
        toolNames: ['Edit', 'Grep', 'Read', 'Write'],
        toolCallsByName: { Read: 4, Grep: 2, Edit: 3, Write: 1 },
        errorCount: 0,
      };

      // 6 exploration calls (Read: 4, Grep: 2) out of 10
      expect(explorationRatio(summary)).toBe(0.6);
    });

    it('accepts custom exploration tools list', () => {
      const summary: TraceSummary = {
        eventCount: 6,
        toolNames: ['CustomTool', 'Edit', 'OtherTool'],
        toolCallsByName: { CustomTool: 3, Edit: 2, OtherTool: 1 },
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
        toolNames: ['Read'],
        toolCallsByName: { Read: 5 },
        errorCount: 0,
      };

      expect(tokensPerTool(summary)).toBeUndefined();
    });

    it('returns undefined when there are no tool calls', () => {
      const summary: TraceSummary = {
        eventCount: 0,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        tokenUsage: { input: 1000, output: 500 },
      };

      expect(tokensPerTool(summary)).toBeUndefined();
    });

    it('computes correct tokens per tool', () => {
      const summary: TraceSummary = {
        eventCount: 5,
        toolNames: ['Read', 'Edit'],
        toolCallsByName: { Read: 3, Edit: 2 },
        errorCount: 0,
        tokenUsage: { input: 1000, output: 500 },
      };

      // Total tokens: 1500, divided by 5 tool calls = 300 tokens per tool
      expect(tokensPerTool(summary)).toBe(300);
    });

    it('handles cached tokens in total calculation', () => {
      const summary: TraceSummary = {
        eventCount: 4,
        toolNames: ['Read'],
        toolCallsByName: { Read: 4 },
        errorCount: 0,
        tokenUsage: { input: 800, output: 400, cached: 200 },
      };

      // Total tokens: 800 + 400 = 1200 (cached not added to total)
      expect(tokensPerTool(summary)).toBe(300);
    });
  });

  describe('avgToolDurationMs', () => {
    it('returns undefined when toolDurations is not available', () => {
      const summary: TraceSummary = {
        eventCount: 5,
        toolNames: ['Read'],
        toolCallsByName: { Read: 5 },
        errorCount: 0,
      };

      expect(avgToolDurationMs(summary)).toBeUndefined();
    });

    it('returns undefined when toolDurations is empty', () => {
      const summary: TraceSummary = {
        eventCount: 0,
        toolNames: [],
        toolCallsByName: {},
        errorCount: 0,
        toolDurations: {},
      };

      expect(avgToolDurationMs(summary)).toBeUndefined();
    });

    it('computes correct average duration', () => {
      const summary: TraceSummary = {
        eventCount: 4,
        toolNames: ['Read', 'Edit'],
        toolCallsByName: { Read: 3, Edit: 1 },
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
        toolNames: ['Grep'],
        toolCallsByName: { Grep: 3 },
        errorCount: 0,
        toolDurations: {
          Grep: [100, 200, 300],
        },
      };

      expect(avgToolDurationMs(summary)).toBe(200);
    });
  });

  describe('mergeExecutionMetrics', () => {
    const baseSummary: TraceSummary = {
      eventCount: 5,
      toolNames: ['Read', 'Edit'],
      toolCallsByName: { Read: 3, Edit: 2 },
      errorCount: 0,
    };

    it('returns the same summary when no metrics provided', () => {
      const result = mergeExecutionMetrics(baseSummary);

      expect(result).toBe(baseSummary);
    });

    it('returns the same summary when metrics is undefined', () => {
      const result = mergeExecutionMetrics(baseSummary, undefined);

      expect(result).toBe(baseSummary);
    });

    it('merges tokenUsage into summary', () => {
      const result = mergeExecutionMetrics(baseSummary, {
        tokenUsage: { input: 1000, output: 500 },
      });

      expect(result.eventCount).toBe(5);
      expect(result.toolNames).toEqual(['Read', 'Edit']);
      expect(result.tokenUsage).toEqual({ input: 1000, output: 500 });
      expect(result.costUsd).toBeUndefined();
      expect(result.durationMs).toBeUndefined();
    });

    it('merges all metrics into summary', () => {
      const result = mergeExecutionMetrics(baseSummary, {
        tokenUsage: { input: 1000, output: 500, cached: 100 },
        costUsd: 0.05,
        durationMs: 12000,
      });

      expect(result.eventCount).toBe(5);
      expect(result.toolNames).toEqual(['Read', 'Edit']);
      expect(result.tokenUsage).toEqual({ input: 1000, output: 500, cached: 100 });
      expect(result.costUsd).toBe(0.05);
      expect(result.durationMs).toBe(12000);
    });

    it('preserves existing summary fields', () => {
      const summaryWithError: TraceSummary = {
        ...baseSummary,
        errorCount: 2,
      };

      const result = mergeExecutionMetrics(summaryWithError, {
        costUsd: 0.1,
      });

      expect(result.errorCount).toBe(2);
      expect(result.costUsd).toBe(0.1);
    });

    it('does not mutate the original summary', () => {
      const result = mergeExecutionMetrics(baseSummary, {
        tokenUsage: { input: 1000, output: 500 },
      });

      expect(baseSummary.tokenUsage).toBeUndefined();
      expect(result.tokenUsage).toEqual({ input: 1000, output: 500 });
    });
  });
});
