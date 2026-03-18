import { describe, expect, it } from 'bun:test';

import { ToolTrajectoryEvaluator } from '../../src/evaluation/evaluators.js';
import type { EvaluationContext } from '../../src/evaluation/evaluators.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { Message, Provider } from '../../src/evaluation/providers/types.js';
import type { ToolTrajectoryEvaluatorConfig, TraceSummary } from '../../src/evaluation/trace.js';
import { computeTraceSummary } from '../../src/evaluation/trace.js';
import type { EvalTest } from '../../src/evaluation/types.js';

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
    return { output: [] };
  },
};

const mockEvalCase: EvalTest = {
  id: 'test-case',
  question: 'Test question',
  input: [],
  input_segments: [],
  expected_output: [],
  guideline_paths: [],
  file_paths: [],
  criteria: 'Expected outcome',
};

function createContext(options: {
  trace?: TraceSummary;
  output?: readonly Message[];
}): EvaluationContext {
  return {
    evalCase: mockEvalCase,
    candidate: '',
    target: mockTarget,
    provider: mockProvider,
    attempt: 0,
    promptInputs: { question: '', guidelines: '' },
    now: new Date(),
    trace: options.trace,
    output: options.output,
  };
}

describe('ToolTrajectoryEvaluator', () => {
  describe('no trace available', () => {
    it('returns score 0 when no trace is provided', () => {
      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'any_order',
        minimums: { search: 1 },
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({}));

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.assertions.filter(a => !a.passed).map(a => a.text)).toContain('No trace available for evaluation');
    });
  });

  describe('any_order mode', () => {
    it('passes when all minimums are met', () => {
      const output: Message[] = [
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
      const { trace } = computeTraceSummary(output);

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'any_order',
        minimums: { search: 3, analyze: 1 },
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          trace,
        }),
      );

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.assertions.filter(a => a.passed).length).toBe(2);
      expect(result.assertions.filter(a => !a.passed).length).toBe(0);
    });

    it('fails when minimums are not met', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search' }, { tool: 'analyze' }],
        },
      ];
      const { trace } = computeTraceSummary(output);

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'any_order',
        minimums: { search: 3, analyze: 1 },
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          trace,
        }),
      );

      expect(result.score).toBe(0.5); // 1 out of 2 checks passed
      expect(result.verdict).toBe('fail');
      expect(result.assertions.filter(a => a.passed).length).toBe(1); // analyze passed
      expect(result.assertions.filter(a => !a.passed).length).toBe(1); // search failed
      expect(result.assertions.filter(a => !a.passed)[0].text).toContain('search: called 1 times (required >=3)');
    });
  });

  describe.each([
    {
      mode: 'in_order' as const,
      passOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { tool: 'init', input: {}, output: {} },
            { tool: 'search', input: {}, output: {} },
            { tool: 'analyze', input: {}, output: {} },
            { tool: 'report', input: {}, output: {} },
          ],
        },
      ],
      passExpected: [{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }],
      passHitCount: 3,
      failOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [{ tool: 'search', input: {}, output: {} }],
        },
      ],
      failExpected: [{ tool: 'search' }, { tool: 'analyze' }],
      failScore: 0.5,
      failMissPattern: 'analyze',
    },
    {
      mode: 'exact' as const,
      passOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { tool: 'search', input: {}, output: {} },
            { tool: 'analyze', input: {}, output: {} },
          ],
        },
      ],
      passExpected: [{ tool: 'search' }, { tool: 'analyze' }],
      passHitCount: 2,
      failOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { tool: 'search', input: {}, output: {} },
            { tool: 'wrong', input: {}, output: {} },
          ],
        },
      ],
      failExpected: [{ tool: 'search' }, { tool: 'analyze' }],
      failScore: 0.5,
      failMissPattern: 'expected analyze, got wrong',
    },
    {
      mode: 'superset' as const,
      passOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { tool: 'init', input: {} },
            { tool: 'search', input: {} },
            { tool: 'analyze', input: {} },
          ],
        },
      ],
      passExpected: [{ tool: 'search' }, { tool: 'analyze' }],
      passHitCount: 2,
      failOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { tool: 'search', input: {} },
            { tool: 'cleanup', input: {} },
          ],
        },
      ],
      failExpected: [{ tool: 'search' }, { tool: 'analyze' }],
      failScore: 0.5,
      failMissPattern: 'analyze',
    },
    {
      mode: 'subset' as const,
      passOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { tool: 'read', input: {} },
            { tool: 'search', input: {} },
          ],
        },
      ],
      passExpected: [{ tool: 'read' }, { tool: 'search' }, { tool: 'analyze' }],
      passHitCount: 2,
      failOutput: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { tool: 'read', input: {} },
            { tool: 'delete', input: {} },
          ],
        },
      ],
      failExpected: [{ tool: 'read' }, { tool: 'search' }],
      failScore: 0.5,
      failMissPattern: 'delete',
    },
  ])(
    '$mode mode — basic pass/fail',
    ({
      mode,
      passOutput,
      passExpected,
      passHitCount,
      failOutput,
      failExpected,
      failScore,
      failMissPattern,
    }) => {
      it('passes when expected tools are satisfied', () => {
        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode,
          expected: passExpected,
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output: passOutput }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.assertions.filter(a => a.passed).length).toBe(passHitCount);
      });

      it('fails when expected tools are not satisfied', () => {
        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode,
          expected: failExpected,
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output: failOutput }));

        expect(result.score).toBe(failScore);
        expect(result.verdict).toBe('fail');
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes(failMissPattern))).toBe(true);
      });
    },
  );

  describe('in_order mode', () => {
    it('fails when expected tool is missing (scan-forward semantics)', () => {
      const output: Message[] = [
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
        type: 'tool-trajectory',
        mode: 'in_order',
        expected: [{ tool: 'search' }, { tool: 'analyze' }, { tool: 'report' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          output,
        }),
      );

      // in_order scans forward - after finding 'search' at 0, it looks for 'analyze'
      // Skips 'report' (index 1) looking for analyze, then moves past end, so analyze not found
      // Then looks for 'report' from index 2, which doesn't exist, so report also not found
      expect(result.score).toBeCloseTo(1 / 3); // Only search found
      expect(result.verdict).toBe('fail');
      expect(result.assertions.filter(a => a.passed).length).toBe(1);
      expect(result.assertions.filter(a => !a.passed).length).toBe(2);
    });

    it('fails when tools appear in wrong order', () => {
      const output: Message[] = [
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
        type: 'tool-trajectory',
        mode: 'in_order',
        expected: [{ tool: 'search' }, { tool: 'report' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          output,
        }),
      );

      // in_order logic: finds search at position 1, then tries to find report at position >= 2 which doesn't exist
      expect(result.score).toBe(0.5); // Only one tool found in order
      expect(result.verdict).toBe('fail');
    });
  });

  describe('exact mode', () => {
    it('fails when trace has extra tools', () => {
      const output: Message[] = [
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
        type: 'tool-trajectory',
        mode: 'exact',
        expected: [{ tool: 'search' }, { tool: 'analyze' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(
        createContext({
          output,
        }),
      );

      expect(result.score).toBe(1); // All expected found at correct positions
      expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('Expected 2 tool calls, got 3'))).toBe(true);
    });
  });

  describe('argument matching', () => {
    describe('exact mode with args (default exact args matching)', () => {
      it('passes when args match exactly (bidirectional deep equality)', () => {
        const output: Message[] = [
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
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [
            { tool: 'search', args: { query: 'test', limit: 10 } },
            { tool: 'analyze', args: { format: 'json' } },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('fails when actual has extra keys (exact mode is bidirectional)', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'test', limit: 10, extra: true } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test', limit: 10 } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // With exact args matching (new default), extra keys cause failure
        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('args mismatch'))).toBe(true);
      });

      it('fails when args do not match', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'wrong', limit: 10 } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test', limit: 10 } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('args mismatch'))).toBe(true);
      });

      it('skips arg validation with args: any', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'anything', limit: 999 } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: 'any' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('matches without args field (backward compatibility)', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { any: 'args' } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });
    });

    describe('superset args matching mode', () => {
      it('passes when actual has extra keys with args_match: superset', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'test', limit: 10, extra: true } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test', limit: 10 }, argsMatch: 'superset' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('fails when expected key is missing from actual with args_match: superset', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'test' } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test', limit: 10 }, argsMatch: 'superset' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
      });
    });

    describe('subset args matching mode', () => {
      it('passes when actual is a subset of expected with args_match: subset', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'test' } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test', limit: 10 }, argsMatch: 'subset' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('fails when actual has unexpected keys with args_match: subset', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { query: 'test', extra: true } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test' }, argsMatch: 'subset' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
      });
    });

    describe('ignore args matching mode', () => {
      it('passes with any args when args_match: ignore', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { completely: 'different', args: true } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test', limit: 10 }, argsMatch: 'ignore' }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });
    });

    describe('field list args matching mode', () => {
      it('checks only specified fields', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              {
                tool: 'search',
                input: { query: 'test', limit: 99, format: 'xml' },
              },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [
            {
              tool: 'search',
              args: { query: 'test', limit: 10, format: 'json' },
              argsMatch: ['query'],
            },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // Only 'query' is checked, which matches
        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('fails when specified field does not match', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              {
                tool: 'search',
                input: { query: 'wrong', limit: 10 },
              },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [
            {
              tool: 'search',
              args: { query: 'test', limit: 10 },
              argsMatch: ['query'],
            },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
      });

      it('supports dot-notation for nested fields', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              {
                tool: 'search',
                input: {
                  config: { query: 'test', format: 'xml' },
                  extra: 'ignored',
                },
              },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [
            {
              tool: 'search',
              args: { config: { query: 'test', format: 'json' } },
              argsMatch: ['config.query'],
            },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // Only config.query is checked, which matches
        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('skips fields not specified in expected', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              {
                tool: 'search',
                input: { query: 'test', limit: 99 },
              },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [
            {
              tool: 'search',
              args: { query: 'test' },
              // 'limit' is in the field list but not in expected args, so it's skipped
              argsMatch: ['query', 'limit'],
            },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });
    });

    describe('args_match at evaluator level', () => {
      it('applies argsMatch to all items without per-item override', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              { tool: 'search', input: { query: 'test', extra1: true } },
              { tool: 'analyze', input: { format: 'json', extra2: true } },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          argsMatch: 'superset',
          expected: [
            { tool: 'search', args: { query: 'test' } },
            { tool: 'analyze', args: { format: 'json' } },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // superset: extras OK
        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('per-item argsMatch overrides evaluator-level argsMatch', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              { tool: 'search', input: { query: 'test', extra: true } },
              { tool: 'analyze', input: { format: 'json', extra: true } },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          argsMatch: 'superset',
          expected: [
            // Uses default superset - extras OK
            { tool: 'search', args: { query: 'test' } },
            // Override to exact - extras cause failure
            { tool: 'analyze', args: { format: 'json' }, argsMatch: 'exact' },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // search passes (superset), analyze fails (exact with extra key)
        expect(result.score).toBe(0.5);
        expect(result.verdict).toBe('fail');
      });

      it('argsMatch with field list', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              { tool: 'search', input: { query: 'test', limit: 999 } },
              { tool: 'analyze', input: { format: 'xml', depth: 5 } },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          argsMatch: ['query', 'format'],
          expected: [
            { tool: 'search', args: { query: 'test', limit: 10 } },
            { tool: 'analyze', args: { format: 'xml', depth: 1 } },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // Only query and format fields checked
        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });
    });

    describe('in_order mode with args', () => {
      it('fails when tool found but args mismatch', () => {
        const output: Message[] = [
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
          type: 'tool-trajectory',
          mode: 'in_order',
          argsMatch: 'superset',
          expected: [
            { tool: 'search', args: { query: 'test' } },
            { tool: 'analyze', args: { format: 'json' } },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0.5);
        expect(result.verdict).toBe('fail');
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('args mismatch'))).toBe(true);
      });
    });

    describe('array argument matching', () => {
      it('matches arrays with deep equality', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { tags: ['a', 'b', 'c'] } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { tags: ['a', 'b', 'c'] } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('fails on array order mismatch', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: { tags: ['c', 'b', 'a'] } }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { tags: ['a', 'b', 'c'] } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
      });
    });

    describe('edge cases', () => {
      it('handles empty args objects', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search', input: {} }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: {} }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });

      it('handles undefined actual args with expected args', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'search' }], // No input/args
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'search', args: { query: 'test' } }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
      });

      it('handles nested objects in args', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [
              {
                tool: 'search',
                input: {
                  config: { query: 'test', options: { limit: 10 } },
                },
              },
            ],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [
            {
              tool: 'search',
              args: { config: { query: 'test', options: { limit: 10 } } },
            },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
      });
    });
  });

  describe('latency assertions', () => {
    describe('in_order mode with latency', () => {
      it('passes when latency is within limit', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' }, durationMs: 45 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'in_order',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.assertions.filter(a => a.passed).some((a) => a.text.includes('45ms (max: 100ms)'))).toBe(true);
      });

      it('fails when latency exceeds limit', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' }, durationMs: 120 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'in_order',
          expected: [{ tool: 'Read', maxDurationMs: 50 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0.5); // 1 sequence passed, 0 latency passed out of 2 total assertions
        expect(result.verdict).toBe('fail');
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('120ms (max: 50ms)'))).toBe(true);
      });

      it('skips latency check when no duration data available', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' } }], // No durationMs
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'in_order',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // Sequence hit counts, latency skipped - neutral (doesn't count against score)
        // 1 sequence assertion, latency assertion skipped = 1 total effective assertion
        expect(result.score).toBe(1); // 1 hit out of 1 effective assertion (skipped latency is neutral)
        expect(result.assertions.filter(a => a.passed).some((a) => a.text.includes('Found Read'))).toBe(true);
        // Latency result should not appear in assertions
        expect(result.assertions.filter(a => a.passed).some((a) => a.text.includes('ms (max:'))).toBe(false);
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('ms (max:'))).toBe(false);
      });

      it('handles mixed latency assertions', () => {
        const output: Message[] = [
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
          type: 'tool-trajectory',
          mode: 'in_order',
          expected: [
            { tool: 'Read', maxDurationMs: 100 },
            { tool: 'Edit' }, // No latency assertion
            { tool: 'Write', maxDurationMs: 500 },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // 3 sequence assertions + 2 latency assertions = 5 total
        // 3 sequence passed + 1 latency passed (Read) = 4 passed
        // 1 latency failed (Write)
        expect(result.expectedAspectCount).toBe(5);
        expect(result.assertions.filter(a => a.passed).some((a) => a.text.includes('Read completed in 45ms'))).toBe(true);
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('Write took 600ms'))).toBe(true);
      });
    });

    describe('exact mode with latency', () => {
      it('passes when all latency assertions pass', () => {
        const output: Message[] = [
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
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [
            { tool: 'Read', maxDurationMs: 100 },
            { tool: 'Edit', maxDurationMs: 500 },
          ],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.assertions.filter(a => a.passed).filter((a) => a.text.includes('ms (max:')).length).toBe(2);
      });

      it('fails when latency exceeds limit in exact mode', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', durationMs: 150 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(0.5); // 1 sequence passed out of 2 total assertions
        expect(result.verdict).toBe('fail');
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('150ms (max: 100ms)'))).toBe(true);
      });

      it('does not check latency when sequence does not match', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Write', durationMs: 10 }], // Wrong tool
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // Sequence mismatch - latency is not checked
        expect(result.score).toBe(0);
        expect(result.verdict).toBe('fail');
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('expected Read, got Write'))).toBe(true);
        // No latency result in assertions
        expect(result.assertions.filter(a => a.passed).some((a) => a.text.includes('ms (max:'))).toBe(false);
        expect(result.assertions.filter(a => !a.passed).some((a) => a.text.includes('ms (max:'))).toBe(false);
      });

      it('handles exact boundary condition', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', durationMs: 100 }], // Exactly at limit
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        // Exactly at limit should pass (<=)
        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.assertions.filter(a => a.passed).some((a) => a.text.includes('100ms (max: 100ms)'))).toBe(true);
      });
    });

    describe('latency with args', () => {
      it('checks latency only when args match', () => {
        const output: Message[] = [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Read', input: { file_path: 'config.json' }, durationMs: 45 }],
          },
        ];

        const config: ToolTrajectoryEvaluatorConfig = {
          name: 'test',
          type: 'tool-trajectory',
          mode: 'exact',
          expected: [{ tool: 'Read', args: { file_path: 'config.json' }, maxDurationMs: 100 }],
        };
        const evaluator = new ToolTrajectoryEvaluator({ config });

        const result = evaluator.evaluate(createContext({ output }));

        expect(result.score).toBe(1);
        expect(result.verdict).toBe('pass');
        expect(result.assertions.filter(a => a.passed).some((a) => a.text.includes('45ms (max: 100ms)'))).toBe(true);
      });
    });
  });

  describe('superset trajectory mode', () => {
    it('consumes matched calls (greedy, no reuse)', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search', input: {} }],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'superset',
        expected: [
          { tool: 'search' },
          { tool: 'search' }, // Needs a second search call
        ],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(0.5); // Only one search found
      expect(result.verdict).toBe('fail');
    });

    it('handles empty expected list', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search', input: {} }],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'superset',
        expected: [],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('matches with args using evaluator-level argsMatch', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search', input: { query: 'test', limit: 10, extra: true } }],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'superset',
        argsMatch: 'superset',
        expected: [{ tool: 'search', args: { query: 'test' } }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('subset trajectory mode', () => {
    it('expected items are reusable (not consumed)', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'read', input: {} },
            { tool: 'read', input: {} },
            { tool: 'read', input: {} },
          ],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'subset',
        expected: [
          { tool: 'read' }, // Single expected item allows any number of reads
        ],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('passes with empty actual calls (trivially a subset)', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'subset',
        expected: [{ tool: 'read' }, { tool: 'search' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('fails with actual calls when expected is empty', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'read', input: {} }],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'subset',
        expected: [],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });

    it('matches with args using per-item argsMatch', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search', input: { query: 'test', extra: true } }],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'subset',
        expected: [{ tool: 'search', args: { query: 'test' }, argsMatch: 'superset' }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('fails when args do not match in subset mode', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search', input: { query: 'wrong' } }],
        },
      ];

      const config: ToolTrajectoryEvaluatorConfig = {
        name: 'test',
        type: 'tool-trajectory',
        mode: 'subset',
        expected: [{ tool: 'search', args: { query: 'test' } }],
      };
      const evaluator = new ToolTrajectoryEvaluator({ config });

      const result = evaluator.evaluate(createContext({ output }));

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });
  });
});
