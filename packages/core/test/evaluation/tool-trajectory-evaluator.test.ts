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
  });

  describe('argument matching', () => {
    describe('exact mode with args', () => {
      it('passes when args match exactly', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [
              { tool: 'search', input: { query: 'test', limit: 10 } },
              { tool: 'analyze', input: { format: 'json' } },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [
            { tool: 'search', args: { query: 'test', limit: 10 } },
            { tool: 'analyze', args: { format: 'json' } },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('fails when args do not match', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'wrong', limit: 10 } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test', limit: 10 } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
        expect(result.misses.some((m) => m.includes('args mismatch'))).toBe(true);
      });

      it('skips arg validation with args: any', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'anything', limit: 999 } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: 'any' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('matches without args field (backward compatibility)', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { any: 'args' } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'search' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });
    });

    describe('in_order mode with args', () => {
      it('fails when tool found but args mismatch', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [
              { tool: 'search', input: { query: 'wrong' } },
              { tool: 'analyze', input: { format: 'json' } },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'in_order',
          expected: [
            { tool: 'search', args: { query: 'test' } },
            { tool: 'analyze', args: { format: 'json' } },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(0.5);
        expect(result.verdict).toBe('fail');
        expect(result.misses.some((m) => m.includes('args mismatch'))).toBe(true);
      });
    });

    describe('array argument matching', () => {
      it('matches arrays with deep equality', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { tags: ['a', 'b', 'c'] } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { tags: ['a', 'b', 'c'] } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('fails on array order mismatch', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { tags: ['c', 'b', 'a'] } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { tags: ['a', 'b', 'c'] } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
      });
    });
  });

  describe('latency assertions', () => {
    describe('in_order mode with latency', () => {
      it('passes when latency is within limit', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' }, durationMs: 45 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'in_order',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.hits.some((h) => h.includes('45ms (max: 100ms)'))).toBe(true);
      });

      it('fails when latency exceeds limit', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' }, durationMs: 120 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'in_order',
          expected: [{ tool: 'Read', maxDurationMs: 50 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(0.5); // 1 sequence hit, 0 latency hits out of 2 total assertions
        expect(result.verdict).toBe('fail');
        expect(result.misses.some((m) => m.includes('120ms (max: 50ms)'))).toBe(true);
      });

      it('skips latency check when no duration data available', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' } }], // No durationMs
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'in_order',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        // Sequence hit counts, latency skipped - neutral (doesn't count against score)
        // 1 sequence assertion, latency assertion skipped = 1 total effective assertion
        expect(result.score).toBe(1); // 1 hit out of 1 effective assertion (skipped latency is neutral)
        expect(result.hits.some((h) => h.includes('Found Read'))).toBe(true);
        // Latency result should not appear in hits or misses
        expect(result.hits.some((h) => h.includes('ms (max:'))).toBe(false);
        expect(result.misses.some((m) => m.includes('ms (max:'))).toBe(false);
      });

      it('handles mixed latency assertions', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [
              { tool: 'Read', durationMs: 45 },
              { tool: 'Edit' }, // No timing
              { tool: 'Write', durationMs: 600 },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'in_order',
          expected: [
            { tool: 'Read', maxDurationMs: 100 },
            { tool: 'Edit' }, // No latency assertion
            { tool: 'Write', maxDurationMs: 500 },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        // 3 sequence assertions + 2 latency assertions = 5 total
        // 3 sequence hits + 1 latency hit (Read) = 4 hits
        // 1 latency miss (Write)
        expect(result.expectedAspectCount).toBe(5);
        expect(result.hits.some((h) => h.includes('Read completed in 45ms'))).toBe(true);
        expect(result.misses.some((m) => m.includes('Write took 600ms'))).toBe(true);
      });
    });

    describe('exact mode with latency', () => {
      it('passes when all latency assertions pass', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [
              { tool: 'Read', durationMs: 30 },
              { tool: 'Edit', durationMs: 200 },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [
            { tool: 'Read', maxDurationMs: 100 },
            { tool: 'Edit', maxDurationMs: 500 },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.hits.filter((h) => h.includes('ms (max:')).length).toBe(2);
      });

      it('fails when latency exceeds limit in exact mode', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', durationMs: 150 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(0.5); // 1 sequence hit out of 2 total assertions
        expect(result.verdict).toBe('fail');
        expect(result.misses.some((m) => m.includes('150ms (max: 100ms)'))).toBe(true);
      });

      it('does not check latency when sequence does not match', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Write', durationMs: 10 }], // Wrong tool
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        // Sequence mismatch - latency is not checked
        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
        expect(result.misses.some((m) => m.includes('expected Read, got Write'))).toBe(true);
        // No latency result in hits or misses
        expect(result.hits.some((h) => h.includes('ms (max:'))).toBe(false);
        expect(result.misses.some((m) => m.includes('ms (max:'))).toBe(false);
      });

      it('handles exact boundary condition', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', durationMs: 100 }], // Exactly at limit
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        // Exactly at limit should pass (<=)
        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.hits.some((h) => h.includes('100ms (max: 100ms)'))).toBe(true);
      });
    });

    describe('latency with args', () => {
      it('checks latency only when args match', () => {
        const outputMessages: OutputMessage[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' }, durationMs: 45 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool_trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', args: { file_path: 'config.json' }, maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ outputMessages }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.hits.some((h) => h.includes('45ms (max: 100ms)'))).toBe(true);
      });
    });
  });
});
