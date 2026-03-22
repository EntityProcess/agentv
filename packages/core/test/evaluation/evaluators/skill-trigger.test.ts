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
  describe('provider tool resolution', () => {
    it('should resolve claude-cli to Claude tool names', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'claude-cli', targetName: 'test' },
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

    it('should resolve copilot-cli to Copilot tool names', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'copilot-cli', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'Read File',
                input: { file_path: '/path/to/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });

    it('should fall back to Claude defaults for unknown provider', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'openai', targetName: 'test' },
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
    });

    it('should detect codex mcp skill tool (skill name in tool name)', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'codex', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'mcp:claude-code/csv-analyzer', input: {} }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });

    it('should detect codex mcp skill tool with arbitrary server name', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'codex', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'mcp:skills/csv-analyzer', input: {} }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should detect pi-coding-agent read tool loading skill file', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'pi-coding-agent', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'read',
                input: { path: '/workspace/.agents/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });

    it('should fail for pi-coding-agent with non-matching read call', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'pi-coding-agent', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: 'some response',
            toolCalls: [{ tool: 'read', input: { path: '/workspace/README.md' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should detect codex bash command_execution reading skill file', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'codex', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'command_execution',
                input: {
                  command:
                    '/bin/bash -lc "sed -n \'1,220p\' /home/user/.agents/skills/csv-analyzer/SKILL.md"',
                },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });

    it('should fail for codex with non-matching tool calls', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'codex', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: 'some response',
            toolCalls: [{ tool: 'command_execution', input: { command: 'ls -la' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
      expect(result.assertions.filter((a) => !a.passed)[0].text).toContain('csv-analyzer');
    });

    it('should pass for codex with should_trigger: false and unrelated tool', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        provider: { kind: 'codex', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: 'some response',
            toolCalls: [{ tool: 'command_execution', input: { command: 'ls -la' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('backward compatibility', () => {
    it('should work with existing Claude Skill tool calls', () => {
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
    });

    it('should work with existing Claude Read tool calls', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'Read',
                input: { file_path: '/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should fail when first tool is unrelated', () => {
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

    it('should support should_trigger: false', () => {
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
  });

  describe('full transcript scanning', () => {
    it('should pass when skill triggers after a preamble meta-skill', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'copilot-cli', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { tool: 'Using skill: using-superpowers', input: {} },
              { tool: 'Using skill: csv-analyzer', input: {} },
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
              { tool: 'Using skill: using-superpowers', input: {} },
              { tool: 'Bash', input: { command: 'ls' } },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('fail');
    });

    it('should pass for should_trigger:false when skill never appears in transcript', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'Using skill: using-superpowers', input: {} }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should fail for should_trigger:false when skill appears later in transcript', () => {
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
  });

  describe('pi-coding-agent tools', () => {
    it('should detect pi-coding-agent read tool loading skill from .agents/skills', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'pi-coding-agent', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'read',
                input: { path: '.agents/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });

    it('should detect pi-coding-agent read tool loading skill from global path', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'pi-coding-agent', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'read',
                input: { path: '/home/user/.agents/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should pass for pi-coding-agent with should_trigger: false and unrelated tool', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig({ should_trigger: false }));
      const context = makeContext({
        provider: { kind: 'pi-coding-agent', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: 'some response',
            toolCalls: [{ tool: 'bash', input: { command: 'ls' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('copilot-specific tools', () => {
    it('should recognize readFile tool for copilot', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'copilot-cli', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'readFile',
                input: { file_path: '/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should recognize readTextFile tool for copilot', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'copilot-cli', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                tool: 'readTextFile',
                input: { file_path: '/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });

    it('should recognize lowercase skill tool for copilot', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'copilot-cli', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'skill', input: { skill: 'csv-analyzer' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
    });
  });
});
