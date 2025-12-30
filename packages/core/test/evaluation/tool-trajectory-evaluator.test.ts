import { describe, expect, it } from 'bun:test';

import { ToolTrajectoryEvaluator } from '../../src/evaluation/evaluators.js';
import type { EvaluationContext } from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { OutputMessage, Provider } from '../../src/evaluation/providers/types.js';
import type { ToolTrajectoryEvaluatorConfig, TraceSummary } from '../../src/evaluation/trace.js';
import { computeTraceSummary } from '../../src/evaluation/trace.js';
import type { EvalCase } from '../../src/evaluation/types.js';

// Minimal mock objects
const mockTarget: ResolvedTarget = {
  name: 'mock',
  kind: 'mock',
  config: {},
};

const mockProvider: Provider = {
  id: 'mock',
  kind: 'mock',
  targetName: 'mock',
  async invoke() {
    return { outputMessages: [] };
  },
};

const mockEvalCase: EvalCase = {
  id: 'test-case',
  question: 'Test question',
  input_messages: [],
  input_segments: [],
  expected_messages: [],
  guideline_paths: [],
  file_paths: [],
  code_snippets: [],
  expected_outcome: 'Expected outcome',
};

function createContext(options: {
  traceSummary?: TraceSummary;
  outputMessages?: readonly OutputMessage[];
}): EvaluationContext {
  return {
    evalCase: mockEvalCase,
    candidate: '',
    target: mockTarget,
    provider: mockProvider,
    attempt: 0,
    promptInputs: { question: '', guidelines: '' },
    now: new Date(),
    traceSummary: options.traceSummary,
    outputMessages: options.outputMessages,
  };
}

describe('ToolTrajectoryEvaluator', () => {
  describe('no trace available', () => {
    it('returns score 0 when no trace is provided', () => {
      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'any_order',
        minimums: { search: 1 },
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({}));

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses).toContain('No trace available for evaluation');
    });
  });

  describe('any_order mode', () => {
    it('passes when all minimums are met', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search' },
            { tool: 'search' },
            { tool: 'search' },
            { tool: 'analyze' },
          ],
        },
      ];
      const summary = computeTraceSummary(outputMessages);

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'any_order',
        minimums: { search: 3, analyze: 1 },
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          traceSummary: summary,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits.length).toBe(2);
      expect(result.misses.length).toBe(0);
    });

    it('fails when minimums are not met', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search' }, { tool: 'analyze' }],
        },
      ];
      const summary = computeTraceSummary(outputMessages);

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'any_order',
        minimums: { search: 3, analyze: 1 },
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          traceSummary: summary,
        }),
      );

      expect(result.score).toBe(0.5); // 1 out of 2 checks passed
      expect(result.verdict).toBe('fail');
      expect(result.hits.length).toBe(1); // analyze passed
      expect(result.misses.length).toBe(1); // search failed
      expect(result.misses[0]).toContain('search: called 1 times (required ≥3)');
    });

    it('handles partial scoring correctly', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'toolA' }, { tool: 'toolA' }, { tool: 'toolB' }],
        },
      ];
      const summary = computeTraceSummary(outputMessages);

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'any_order',
        minimums: { toolA: 2, toolB: 2, toolC: 1 }, // Only toolA meets the minimum
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          traceSummary: summary,
        }),
      );

      expect(result.score).toBeCloseTo(1 / 3); // Only 1 out of 3 checks passed
      expect(result.verdict).toBe('fail');
    });
  });

  describe('in_order mode', () => {
    it('passes when tools appear in expected order', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'init', input: {}, output: {} },
            { tool: 'search', input: {}, output: {} },
            { tool: 'analyze', input: {}, output: {} },
            { tool: 'report', input: {}, output: {} },
          ],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'in_order',
        expected: [{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          outputMessages,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits.length).toBe(3);
    });

    it('fails when expected tool is missing', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', input: {}, output: {} },
            { tool: 'report', input: {}, output: {} },
          ],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'in_order',
        expected: [{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          outputMessages,
        }),
      );

      // in_order scans forward - after finding 'search' at 0, it looks for 'analyze'
      // Skips 'report' (index 1) looking for analyze, then moves past end, so analyze not found
      // Then looks for 'report' from index 2, which doesn't exist, so report also not found
      expect(result.score).toBeCloseTo(1 / 3); // Only search found
      expect(result.verdict).toBe('fail');
      expect(result.hits.length).toBe(1);
      expect(result.misses.length).toBe(2);
    });

    it('fails when tools appear in wrong order', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'report', input: {}, output: {} },
            { tool: 'search', input: {}, output: {} },
          ],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'in_order',
        expected: [{ tool: 'search' }, { tool: 'report' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          outputMessages,
        }),
      );

      // search is at position 1, but we look from position 0
      // After finding report at 0, we search from 1 but report is not found again
      // Actually in_order logic: finds search at position 1, then tries to find report at position >= 2 which doesn't exist
      expect(result.score).toBe(0.5); // Only one tool found in order
      expect(result.verdict).toBe('fail');
    });
  });

  describe('exact mode', () => {
    it('passes when trace exactly matches expected', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', input: {}, output: {} },
            { tool: 'analyze', input: {}, output: {} },
          ],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'exact',
        expected: [{ tool: 'search' }, { tool: 'analyze' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          outputMessages,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('fails when trace has extra tools', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', input: {}, output: {} },
            { tool: 'analyze', input: {}, output: {} },
            { tool: 'extra', input: {}, output: {} },
          ],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'exact',
        expected: [{ tool: 'search' }, { tool: 'analyze' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          outputMessages,
        }),
      );

      expect(result.score).toBe(1); // All expected found at correct positions
      expect(result.misses.some((m) => m.includes('Expected 2 tool calls, got 3'))).toBe(true);
    });

    it('fails when trace has wrong tool at position', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', input: {}, output: {} },
            { tool: 'wrong', input: {}, output: {} },
          ],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'exact',
        expected: [{ tool: 'search' }, { tool: 'analyze' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          outputMessages,
        }),
      );

      expect(result.score).toBe(0.5); // Only position 0 matches
      expect(result.verdict).toBe('fail');
      expect(result.misses.some((m) => m.includes('expected analyze, got wrong'))).toBe(true);
    });

    it('fails when trace is shorter than expected', () => {
      const outputMessages: OutputMessage[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search', input: {}, output: {} }],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool_trajectory',
        mode: 'exact',
        expected: [{ tool: 'search' }, { tool: 'analyze' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          outputMessages,
        }),
      );

      expect(result.score).toBe(0.5); // Only 1 out of 2 positions matches
      expect(result.misses.some((m) => m.includes('expected analyze, got nothing'))).toBe(true);
    });
  });
});
