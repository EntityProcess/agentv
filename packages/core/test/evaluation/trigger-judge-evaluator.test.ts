import { describe, expect, it } from 'bun:test';

import { TriggerJudgeEvaluator } from '../../src/evaluation/evaluators/trigger-judge.js';
import type { TriggerJudgeEvaluatorConfig } from '../../src/evaluation/evaluators/trigger-judge.js';
import type { EvaluationContext } from '../../src/evaluation/evaluators/types.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { Message, Provider } from '../../src/evaluation/providers/types.js';
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

function createContext(output?: readonly Message[]): EvaluationContext {
  return {
    evalCase: mockEvalCase,
    candidate: '',
    target: mockTarget,
    provider: mockProvider,
    attempt: 0,
    promptInputs: { question: '', guidelines: '' },
    now: new Date(),
    output,
  };
}

function makeConfig(skill: string): TriggerJudgeEvaluatorConfig {
  return { name: 'trigger-judge-test', type: 'trigger-judge', skill };
}

describe('TriggerJudgeEvaluator', () => {
  describe('no output / no tool calls', () => {
    it('fails when no output is provided', () => {
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(undefined));
      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(result.misses.length).toBeGreaterThan(0);
    });

    it('fails when output is empty array', () => {
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext([]));
      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });

    it('fails when messages have no tool calls', () => {
      const output: Message[] = [{ role: 'assistant', content: 'Hello world' }];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });
  });

  describe('Skill tool call detection', () => {
    it('passes when Skill tool is called with exact skill name in args.skill', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Skill',
              input: { skill: 'ship' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
      expect(result.hits.length).toBeGreaterThan(0);
    });

    it('passes when Skill tool args.skill contains the skill name (case-insensitive)', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Skill',
              input: { skill: 'agentv-ship' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('passes when Skill tool args.skill matches case-insensitively', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Skill',
              input: { skill: 'SHIP' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('fails when Skill tool is called with a different skill name', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Skill',
              input: { skill: 'create-eval' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });

    it('passes when Skill tool is called in a later message', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          content: 'Thinking...',
          toolCalls: [{ tool: 'Read', input: { file_path: '/some/file.ts' } }],
        },
        {
          role: 'assistant',
          toolCalls: [{ tool: 'Skill', input: { skill: 'ship' } }],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('Read tool call detection (skill file)', () => {
    it('passes when a Read tool loads a file in .claude/commands/ containing skill name', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Read',
              input: { file_path: '/home/user/project/.claude/commands/ship.md' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('passes when a Read tool loads a file in .claude/skills/ containing skill name', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Read',
              input: { file_path: '/home/user/project/.claude/skills/ship/README.md' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(1);
      expect(result.verdict).toBe('pass');
    });

    it('fails when Read tool reads a non-skill file', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Read',
              input: { file_path: '/home/user/project/src/main.ts' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });

    it('fails when Read tool reads from .claude/commands/ but skill name does not match', () => {
      const output: Message[] = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Read',
              input: { file_path: '/home/user/project/.claude/commands/create-eval.md' },
            },
          ],
        },
      ];
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      const result = evaluator.evaluate(createContext(output));
      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });
  });

  describe('provider alias resolution metadata (integration)', () => {
    it('has kind === trigger-judge', () => {
      const evaluator = new TriggerJudgeEvaluator(makeConfig('ship'));
      expect(evaluator.kind).toBe('trigger-judge');
    });
  });
});
