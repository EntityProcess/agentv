import { describe, expect, it } from 'bun:test';

import { defineEval, evalSuite, serializeEvalYaml, toEvalYamlObject } from '../src/eval.js';

describe('YAML-aligned eval authoring helpers', () => {
  it('lowers known AgentV fields to canonical snake_case without broad key rewriting', () => {
    const suite = defineEval({
      name: 'sdk-yaml-suite',
      inputFiles: ['fixtures/shared-system.md'],
      experiment: 'sdk-yaml-run',
      target: {
        extends: 'mock-target',
        model: 'gpt-5-codex',
        reasoningEffort: 'high',
        hooks: {
          beforeAll: {
            command: ['bun', 'run', 'scripts/setup.ts'],
            timeoutMs: 30_000,
          },
        },
      },
      repeat: {
        count: 3,
        strategy: 'pass_any',
        earlyExit: false,
      },
      timeoutSeconds: 600,
      threshold: 0.8,
      budgetUsd: 1.5,
      assertions: [
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
          input: 'Say hello.',
          inputFiles: ['fixtures/prompt.md'],
          expectedOutput: 'Hello there',
          workspace: {
            hooks: {
              beforeEach: {
                script: 'git reset --hard',
                timeoutMs: 5_000,
              },
              afterEach: {
                command: ['git', 'status'],
              },
              afterAll: {
                script: ['echo', 'done'],
              },
            },
          },
          mode: 'conversation',
          turns: [
            {
              input: 'hello?',
              expectedOutput: 'hi',
              assertions: [
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

    expect(typeof suite.target).toBe('object');
    expect(lowered).toEqual({
      name: 'sdk-yaml-suite',
      input_files: ['fixtures/shared-system.md'],
      experiment: 'sdk-yaml-run',
      target: {
        extends: 'mock-target',
        model: 'gpt-5-codex',
        reasoning_effort: 'high',
        hooks: {
          before_all: {
            command: ['bun', 'run', 'scripts/setup.ts'],
            timeout_ms: 30_000,
          },
        },
      },
      repeat: {
        count: 3,
        strategy: 'pass_any',
        early_exit: false,
      },
      timeout_seconds: 600,
      threshold: 0.8,
      evaluate_options: {
        budget_usd: 1.5,
      },
      assertions: [
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
          input: 'Say hello.',
          input_files: ['fixtures/prompt.md'],
          expected_output: 'Hello there',
          workspace: {
            hooks: {
              before_each: {
                script: 'git reset --hard',
                timeout_ms: 5_000,
              },
              after_each: {
                command: ['git', 'status'],
              },
              after_all: {
                script: ['echo', 'done'],
              },
            },
          },
          mode: 'conversation',
          turns: [
            {
              input: 'hello?',
              expected_output: 'hi',
              assertions: [
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

  it('serializes canonical YAML and keeps assertions as the durable field', () => {
    const suite = evalSuite({
      name: 'yaml-round-trip',
      tests: [
        {
          id: 'hello',
          input: 'Say hello',
          expectedOutput: 'Hello',
          assertions: [{ type: 'contains', value: 'Hello' }],
        },
      ],
    });

    const yaml = serializeEvalYaml(suite);

    expect(yaml).toContain('name: yaml-round-trip');
    expect(yaml).toContain('expected_output: Hello');
    expect(yaml).toContain('assertions:');
    expect(yaml).not.toContain('expectedOutput');
    expect(yaml).not.toContain('inputFiles');
  });

  it('preserves a promptfoo-shaped tags map (tags.experiment) without mangling keys', () => {
    const suite = defineEval({
      name: 'sdk-tags-map',
      tags: { experiment: 'sdk-baseline', team: 'compliance' },
      target: 'mock-target',
      tests: [{ id: 'hello', input: 'Say hello', assertions: [{ type: 'contains', value: 'hi' }] }],
    });

    const lowered = toEvalYamlObject(suite);
    expect(lowered.tags).toEqual({ experiment: 'sdk-baseline', team: 'compliance' });
  });

  it('keeps the list form of tags for selection', () => {
    const suite = defineEval({
      name: 'sdk-tags-list',
      tags: ['smoke', 'regression'],
      target: 'mock-target',
      tests: [{ id: 'hello', input: 'Say hello', assertions: [{ type: 'contains', value: 'hi' }] }],
    });

    const lowered = toEvalYamlObject(suite);
    expect(lowered.tags).toEqual(['smoke', 'regression']);
  });

  it('rejects removed experiment authoring blocks', () => {
    expect(() =>
      defineEval({
        name: 'removed-experiment',
        experiment: { target: 'mock' },
        tests: [
          {
            id: 'hello',
            input: 'Say hello',
            assertions: [{ type: 'contains', value: 'hello' }],
          },
        ],
      } as never),
    ).toThrow(/top-level 'experiment'/);
  });

  it('rejects removed top-level repeat aliases', () => {
    expect(() =>
      defineEval({
        name: 'removed-runs',
        runs: 3,
        tests: [
          {
            id: 'hello',
            input: 'Say hello',
            assertions: [{ type: 'contains', value: 'hello' }],
          },
        ],
      } as never),
    ).toThrow(/top-level 'runs'/);
  });
});
