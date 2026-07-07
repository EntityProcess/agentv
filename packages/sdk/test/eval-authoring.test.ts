import { describe, expect, it } from 'bun:test';

import { type EvalConfig, defineEval, serializeEvalYaml, toEvalYamlObject } from '../src/eval.js';

describe('YAML-aligned eval authoring helpers', () => {
  it('lowers known AgentV fields to canonical snake_case without broad key rewriting', () => {
    const suite = defineEval({
      name: 'sdk-yaml-suite',
      inputFiles: ['fixtures/shared-system.md'],
      tags: { experiment: 'sdk-yaml-run' },
      providers: [
        {
          label: 'sdk-codex',
          id: 'codex:gpt-5-codex',
          extends: 'mock-target',
          config: {
            model: 'gpt-5-codex',
            reasoningEffort: 'high',
          },
          hooks: {
            beforeAll: {
              command: ['bun', 'run', 'scripts/setup.ts'],
              timeoutMs: 30_000,
            },
          },
        },
      ],
      defaults: {
        provider: 'sdk-codex',
        grader: 'grader-gpt5-mini',
      },
      defaultTest: {
        options: {
          provider: 'grader-gpt5-mini',
        },
      },
      repeat: 3,
      timeoutSeconds: 600,
      threshold: 0.8,
      budgetUsd: 1.5,
      prompts: ['{{ input }}'],
      assert: [
        {
          type: 'execution-metrics',
          maxToolCalls: 3,
          maxCostUsd: 0.25,
          customThresholdLabel: 'leave-me-alone',
        },
      ],
      tests: [
        {
          id: 'reply-with-hello',
          vars: { input: 'Say hello.' },
          inputFiles: ['fixtures/prompt.md'],
          expectedOutput: 'Hello there',
          environment: {
            type: 'host',
            workdir: 'fixtures/workspace',
            setup: {
              command: ['bun', 'scripts/setup.ts'],
              timeoutMs: 5000,
            },
          },
          mode: 'conversation',
          turns: [
            {
              input: 'hello?',
              expectedOutput: 'hi',
              assert: [
                'mentions hi',
                {
                  type: 'tool-trajectory',
                  expected: [
                    {
                      tool: 'Read',
                      maxDurationMs: 500,
                      argsMatch: ['path'],
                    },
                  ],
                  outputPath: 'artifacts/tool-trace.json',
                  customCamelKey: 'preserve me',
                },
              ],
            },
          ],
          dependsOn: ['setup'],
          onDependencyFailure: 'run',
          onTurnFailure: 'stop',
          windowSize: 2,
        },
      ],
    });

    const lowered = toEvalYamlObject(suite);

    expect(Array.isArray(suite.providers)).toBe(true);
    expect(lowered).toEqual({
      name: 'sdk-yaml-suite',
      input_files: ['fixtures/shared-system.md'],
      tags: { experiment: 'sdk-yaml-run' },
      providers: [
        {
          label: 'sdk-codex',
          id: 'codex:gpt-5-codex',
          extends: 'mock-target',
          config: {
            model: 'gpt-5-codex',
            reasoning_effort: 'high',
          },
          hooks: {
            before_all: {
              command: ['bun', 'run', 'scripts/setup.ts'],
              timeout_ms: 30_000,
            },
          },
        },
      ],
      defaults: {
        provider: 'sdk-codex',
        grader: 'grader-gpt5-mini',
      },
      default_test: {
        options: {
          provider: 'grader-gpt5-mini',
        },
      },
      timeout_seconds: 600,
      threshold: 0.8,
      prompts: ['{{ input }}'],
      evaluate_options: {
        repeat: 3,
        budget_usd: 1.5,
      },
      assert: [
        {
          type: 'execution-metrics',
          max_tool_calls: 3,
          max_cost_usd: 0.25,
          customThresholdLabel: 'leave-me-alone',
        },
      ],
      tests: [
        {
          id: 'reply-with-hello',
          vars: { input: 'Say hello.' },
          input_files: ['fixtures/prompt.md'],
          expected_output: 'Hello there',
          environment: {
            type: 'host',
            workdir: 'fixtures/workspace',
            setup: {
              command: ['bun', 'scripts/setup.ts'],
              timeout_ms: 5000,
            },
          },
          mode: 'conversation',
          turns: [
            {
              input: 'hello?',
              expected_output: 'hi',
              assert: [
                'mentions hi',
                {
                  type: 'tool-trajectory',
                  expected: [
                    {
                      tool: 'Read',
                      max_duration_ms: 500,
                      args_match: ['path'],
                    },
                  ],
                  output_path: 'artifacts/tool-trace.json',
                  customCamelKey: 'preserve me',
                },
              ],
            },
          ],
          depends_on: ['setup'],
          on_dependency_failure: 'run',
          on_turn_failure: 'stop',
          window_size: 2,
        },
      ],
    });
  });

  it('serializes canonical YAML and uses the assert block', () => {
    const suite = defineEval({
      name: 'yaml-round-trip',
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'hello',
          vars: { input: 'Say hello' },
          expectedOutput: 'Hello',
          assert: [{ type: 'contains', value: 'Hello' }],
        },
      ],
    });

    const yaml = serializeEvalYaml(suite);

    expect(yaml).toContain('name: yaml-round-trip');
    expect(yaml).toContain('expected_output: Hello');
    expect(yaml).toContain('assert:');
    expect(yaml).not.toContain('expectedOutput');
    expect(yaml).not.toContain('inputFiles');
  });

  it('preserves a promptfoo-shaped tags map (tags.experiment) without mangling keys', () => {
    const suite = defineEval({
      name: 'sdk-tags-map',
      tags: { experiment: 'sdk-baseline', team: 'compliance' },
      providers: ['mock-target'],
      prompts: ['{{ input }}'],
      tests: [
        { id: 'hello', vars: { input: 'Say hello' }, assert: [{ type: 'contains', value: 'hi' }] },
      ],
    });

    const lowered = toEvalYamlObject(suite);
    expect(lowered.tags).toEqual({ experiment: 'sdk-baseline', team: 'compliance' });
  });

  it('authors the Promptfoo-shaped provider and grader-provider surface', () => {
    const config = {
      name: 'sdk-provider-surface',
      providers: [
        'openai:gpt-4.1-mini',
        {
          id: 'agentv:codex-cli',
          label: 'codex-host',
          config: { model: 'gpt-5-codex' },
          env: { AGENTV_MODE: 'test' },
          inputs: { cwd: './workspace' },
        },
        {
          'openai:gpt-5-mini': {
            label: 'grader-provider',
            config: { temperature: 0 },
          },
        },
      ],
      defaults: {
        provider: 'codex-host',
        grader: 'grader-provider',
      },
      defaultTest: {
        vars: { tone: 'brief' },
        options: {
          provider: 'grader-provider',
          transform: 'output.trim()',
        },
      },
      prompts: ['{{ task }}'],
      tests: [
        {
          id: 'provider-options',
          vars: { task: 'Say hello' },
          options: {
            provider: 'case-grader',
          },
          assert: [
            { type: 'llm-rubric', value: 'Greets the user' },
            { type: 'llm-rubric', value: 'Uses concise language', provider: 'assertion-grader' },
          ],
        },
      ],
    } satisfies EvalConfig;

    const lowered = toEvalYamlObject(defineEval(config));

    expect(lowered).toMatchObject({
      providers: [
        'openai:gpt-4.1-mini',
        {
          id: 'agentv:codex-cli',
          label: 'codex-host',
          config: { model: 'gpt-5-codex' },
          env: { AGENTV_MODE: 'test' },
          inputs: { cwd: './workspace' },
        },
        {
          'openai:gpt-5-mini': {
            label: 'grader-provider',
            config: { temperature: 0 },
          },
        },
      ],
      defaults: {
        provider: 'codex-host',
        grader: 'grader-provider',
      },
      default_test: {
        vars: { tone: 'brief' },
        options: {
          provider: 'grader-provider',
          transform: 'output.trim()',
        },
      },
      tests: [
        {
          id: 'provider-options',
          options: {
            provider: 'case-grader',
          },
          assert: [
            { type: 'llm-rubric', value: 'Greets the user' },
            { type: 'llm-rubric', value: 'Uses concise language', provider: 'assertion-grader' },
          ],
        },
      ],
    });
  });

  it('keeps the list form of tags for selection', () => {
    const suite = defineEval({
      name: 'sdk-tags-list',
      tags: ['smoke', 'regression'],
      providers: ['mock-target'],
      prompts: ['{{ input }}'],
      tests: [
        { id: 'hello', vars: { input: 'Say hello' }, assert: [{ type: 'contains', value: 'hi' }] },
      ],
    });

    const lowered = toEvalYamlObject(suite);
    expect(lowered.tags).toEqual(['smoke', 'regression']);
  });

  it('rejects removed direct input authoring surfaces', () => {
    expect(() =>
      defineEval({
        name: 'removed-top-level-input',
        input: 'Say hello',
        tests: [],
      } as never),
    ).toThrow(/top-level 'input'/);

    expect(() =>
      defineEval({
        name: 'removed-test-input',
        prompts: ['{{ input }}'],
        tests: [
          {
            id: 'hello',
            input: 'Say hello',
            assert: [{ type: 'contains', value: 'hello' }],
          },
        ],
      } as never),
    ).toThrow(/tests\[0\]\.input/);
  });

  it('rejects removed public preprocessor authoring', () => {
    expect(() =>
      defineEval({
        name: 'removed-preprocessors',
        prompts: ['{{ input }}'],
        preprocessors: [{ type: 'xlsx', command: ['bun', 'run', 'xlsx-to-text.ts'] }],
        tests: [{ id: 'hello', vars: { input: 'Say hello' } }],
      } as never),
    ).toThrow(/top-level 'preprocessors'.*defaultTest\.options\.transform/);
  });

  it('rejects removed top-level experiment authoring', () => {
    expect(() =>
      defineEval({
        name: 'removed-experiment',
        experiment: 'sdk-baseline',
        prompts: ['{{ input }}'],
        tests: [
          {
            id: 'hello',
            vars: { input: 'Say hello' },
            assert: [{ type: 'contains', value: 'hello' }],
          },
        ],
      } as never),
    ).toThrow(/top-level 'experiment'.*tags.*experiment.*CLI --experiment/);
  });

  it('rejects removed top-level repeat aliases', () => {
    expect(() =>
      defineEval({
        name: 'removed-runs',
        runs: 3,
        prompts: ['{{ input }}'],
        tests: [
          {
            id: 'hello',
            vars: { input: 'Say hello' },
            assert: [{ type: 'contains', value: 'hello' }],
          },
        ],
      } as never),
    ).toThrow(/top-level 'runs'/);
  });

  it('rejects object-shaped repeat authoring', () => {
    expect(() =>
      defineEval({
        name: 'removed-repeat-object',
        repeat: { count: 3, strategy: 'pass_any' },
        prompts: ['{{ input }}'],
        tests: [
          {
            id: 'hello',
            vars: { input: 'Say hello' },
            assert: [{ type: 'contains', value: 'hello' }],
          },
        ],
      } as never),
    ).toThrow(/repeat.*positive integer/);
  });

  it('rejects removed target-shaped authoring', () => {
    expect(() =>
      defineEval({
        name: 'removed-target',
        target: 'mock-target',
        prompts: ['{{ input }}'],
        tests: [{ id: 'hello', vars: { input: 'Say hello' } }],
      } as never),
    ).toThrow(/eval\.target.*provider/);

    expect(() =>
      defineEval({
        name: 'removed-assertion-target',
        providers: ['mock-provider'],
        prompts: ['{{ input }}'],
        tests: [
          {
            id: 'hello',
            vars: { input: 'Say hello' },
            assert: [{ type: 'llm-rubric', value: 'ok', target: 'grader' }],
          },
        ],
      } as never),
    ).toThrow(/target.*provider/);
  });

  it('rejects removed top-level graders authoring', () => {
    expect(() =>
      defineEval({
        name: 'removed-graders',
        providers: ['mock-provider'],
        graders: [{ id: 'openai:gpt-5-mini', label: 'grader-provider' }],
        prompts: ['{{ input }}'],
        tests: [{ id: 'hello', vars: { input: 'Say hello' } }],
      } as never),
    ).toThrow(/top-level 'graders'.*providers/);
  });
});
