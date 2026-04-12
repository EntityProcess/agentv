import { describe, expect, it } from 'vitest';
import { SkillTriggerEvaluator } from '../../../src/evaluation/evaluators/skill-trigger.js';
import type { EvaluationContext } from '../../../src/evaluation/evaluators/types.js';
import type { SkillTriggerEvaluatorConfig } from '../../../src/evaluation/types.js';

// biome-ignore lint/suspicious/noExplicitAny: test helper with partial context
function makeContext(overrides: Record<string, any> = {}): EvaluationContext {
  return {
    evalCase: { id: 'test', input: 'test input' },
    candidate: 'test output',
    target: { name: 'test-target' },
    provider: { kind: 'claude-cli', targetName: 'test' },
    attempt: 1,
    promptInputs: { question: 'test' },
    now: new Date(),
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: partial context for tests
  } as any;
}

function makeConfig(
  overrides: Partial<SkillTriggerEvaluatorConfig> = {},
): SkillTriggerEvaluatorConfig {
  return {
    name: 'test-trigger',
    type: 'skill-trigger',
    skill: 'csv-analyzer',
    ...overrides,
  };
}

describe('SkillTriggerEvaluator', () => {
  describe('canonical tool names (provider-agnostic)', () => {
    it('should detect Skill tool with matching skill name', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Skill', input: { skill: 'csv-analyzer' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });

    it('should detect Read tool loading skill file via file_path', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'Read',
                input: { file_path: '/path/to/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });

    it('should detect skill via tool output reference', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'Bash',
                input: { command: 'grep -r skill' },
                output: 'Found: .agents/skills/csv-analyzer/SKILL.md',
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should fail when skill name does not match', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Skill', input: { skill: 'other-skill' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should fail when Read loads non-skill file', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Read', input: { file_path: '/workspace/README.md' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should fail when only unrelated tools are called', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Bash', input: { command: 'ls' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should handle no tool calls', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [{ role: 'assistant', content: 'no tools used' }],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
      expect(result.assertions.filter((a) => !a.passed)[0].text).toBe('No tool calls recorded');
    });

    it('should work with any provider kind (provider-agnostic)', () => {
      for (const kind of ['claude-cli', 'copilot-cli', 'codex', 'pi-cli', 'openai']) {
        const evaluator = new SkillTriggerEvaluator(makeConfig());
        const context = makeContext({
          provider: { kind, targetName: 'test' },
          output: [
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ tool: 'Skill', input: { skill: 'csv-analyzer' } }],
            },
          ],
        });
        const result = evaluator.evaluate(context);
        expect(result.verdict).toBe('pass');
      }
    });
  });

  describe('should_trigger: false', () => {
    it('should pass when skill is not triggered', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Bash', input: { command: 'ls' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should fail when skill is triggered unexpectedly', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Skill', input: { skill: 'csv-analyzer' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should pass with no tool calls', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        output: [{ role: 'assistant', content: 'no tools used' }],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('full transcript scanning', () => {
    it('should pass when skill triggers after a preamble skill', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { tool: 'Skill', input: { skill: 'using-superpowers' } },
              { tool: 'Skill', input: { skill: 'csv-analyzer' } },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should pass when skill triggers in a later message', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: 'thinking...',
            toolCalls: [{ tool: 'Bash', input: { command: 'ls' } }],
          },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Skill', input: { skill: 'csv-analyzer' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should fail when target skill never appears anywhere in transcript', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { tool: 'Skill', input: { skill: 'using-superpowers' } },
              { tool: 'Bash', input: { command: 'ls' } },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should pass for should_trigger:false when skill never appears', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Skill', input: { skill: 'using-superpowers' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should fail for should_trigger:false when skill appears later', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { tool: 'Bash', input: { command: 'ls' } },
              { tool: 'Skill', input: { skill: 'csv-analyzer' } },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should detect skill loaded via Read in .agents/skills path', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'Read',
                input: { file_path: '.agents/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should detect skill loaded via Read in global path', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'Read',
                input: { file_path: '/home/user/.agents/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });
  });
});
