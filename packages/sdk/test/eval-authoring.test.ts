import { describe, expect, it } from 'bun:test';

import { defineEval, evalSuite, serializeEvalYaml, toEvalYamlObject } from '../src/eval.js';

describe('YAML-aligned eval authoring helpers', () => {
  it('lowers known AgentV fields to canonical snake_case without broad key rewriting', () => {
    const suite = defineEval({
      name: 'sdk-yaml-suite',
      inputFiles: ['fixtures/shared-system.md'],
      target: 'mock-target',
      model: 'gpt-5-codex',
      policy: {
        runs: 3,
        timeoutSeconds: 600,
        threshold: 0.8,
        budgetUsd: 1.5,
      },
      execution: {
        targets: [
          {
            name: 'mock-target',
            useTarget: 'mock_base',
            hooks: {
              beforeAll: {
                command: ['bun', 'run', 'scripts/setup.ts'],
                timeoutMs: 30_000,
              },
            },
          },
        ],
        skipDefaults: true,
        budgetUsd: 1.5,
        failOnError: true,
        keepWorkspaces: true,
      },
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

    expect(suite.execution?.skipDefaults).toBe(true);
    expect(lowered).toEqual({
      name: 'sdk-yaml-suite',
      input_files: ['fixtures/shared-system.md'],
      target: 'mock-target',
      model: 'gpt-5-codex',
      policy: {
        runs: 3,
        timeout_seconds: 600,
        threshold: 0.8,
        budget_usd: 1.5,
      },
      execution: {
        targets: [
          {
            name: 'mock-target',
            use_target: 'mock_base',
            hooks: {
              before_all: {
                command: ['bun', 'run', 'scripts/setup.ts'],
                timeout_ms: 30_000,
              },
            },
          },
        ],
        skip_defaults: true,
        budget_usd: 1.5,
        fail_on_error: true,
        keep_workspaces: true,
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
});
