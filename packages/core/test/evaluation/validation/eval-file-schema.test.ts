import { describe, expect, it } from 'bun:test';
import type { ZodIssue } from 'zod';

import { EvalFileSchema } from '../../../src/evaluation/validation/eval-file.schema.js';

function collectIssueMessages(issues: readonly ZodIssue[]): string[] {
  const messages: string[] = [];
  for (const issue of issues) {
    messages.push(issue.message);
    if (issue.code === 'invalid_union') {
      for (const unionError of issue.unionErrors) {
        messages.push(...collectIssueMessages(unionError.issues));
      }
    }
  }
  return messages;
}

describe('EvalFileSchema input shorthand', () => {
  const baseTest = {
    id: 'test-1',
    criteria: 'Goal',
    vars: { request: 'Classify this request.' },
  };

  it('rejects authored top-level input', () => {
    const result = EvalFileSchema.safeParse({
      input: { task: 'classify', labels: ['bug', 'feature'] },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects authored top-level message input', () => {
    const result = EvalFileSchema.safeParse({
      input: { role: 'user', content: { task: 'classify' } },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects authored test input', () => {
    const result = EvalFileSchema.safeParse({
      tests: [{ ...baseTest, input: 'Question' }],
    });

    expect(result.success).toBe(false);
  });

  it('accepts canonical prompts plus vars authoring', () => {
    const result = EvalFileSchema.safeParse({
      prompts: ['Classify this request: {{ request }}'],
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts scenarios-only promptfoo matrix authoring', () => {
    const result = EvalFileSchema.safeParse({
      prompts: ['Classify {{ request }} at {{ severity }} severity'],
      scenarios: [
        {
          config: [{ vars: { severity: 'high' } }],
          tests: [
            {
              vars: { request: 'database outage' },
              assert: [{ type: 'contains', value: 'outage' }],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts scenario file references in top-level scenarios arrays', () => {
    const result = EvalFileSchema.safeParse({
      prompts: ['Translate {{ phrase }} to {{ language }}'],
      scenarios: [
        {
          config: [{ vars: { language: 'Spanish' } }],
          tests: [{ vars: { phrase: 'hello' }, assert: [{ type: 'equals', value: 'hola' }] }],
        },
        'file://scenarios/*.yaml',
      ],
    });

    expect(result.success).toBe(true);
  });

  it('requires scenario config and tests arrays', () => {
    const result = EvalFileSchema.safeParse({
      prompts: ['Classify {{ request }}'],
      scenarios: [
        {
          tests: [{ vars: { request: 'database outage' } }],
        },
        {
          config: [{ vars: { severity: 'high' } }],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects removed fields inside scenario config and tests', () => {
    const result = EvalFileSchema.safeParse({
      prompts: ['Classify {{ request }}'],
      scenarios: [
        {
          config: [{ input: 'removed', vars: { severity: 'high' } }],
          tests: [{ expected_output: 'removed', vars: { request: 'database outage' } }],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects providerPromptMap baggage', () => {
    const result = EvalFileSchema.safeParse({
      providerPromptMap: { local: ['prompt-a'] },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects removed eval_cases and evalcases aliases as test collections', () => {
    const result = EvalFileSchema.safeParse({
      eval_cases: [baseTest],
      evalcases: [baseTest],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected removed aliases to be rejected');
    const messages = collectIssueMessages(result.error.issues);
    expect(
      messages.some((message) => message.includes("Top-level 'eval_cases' has been removed")),
    ).toBe(true);
    expect(
      messages.some((message) => message.includes("Top-level 'evalcases' has been removed")),
    ).toBe(true);
  });

  it('rejects eval-level execution.max_concurrency', () => {
    const result = EvalFileSchema.safeParse({
      execution: {
        max_concurrency: 2,
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects removed eval-level execution fields', () => {
    const result = EvalFileSchema.safeParse({
      execution: {
        trials: {
          count: 2,
          strategy: 'pass_at_k',
        },
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects removed authored preprocessors and postprocess fields', () => {
    const result = EvalFileSchema.safeParse({
      preprocessors: [{ type: 'xlsx', command: ['node', 'xlsx.js'] }],
      default_test: {
        options: {
          postprocess: 'output.trim()',
        },
      },
      tests: [
        {
          ...baseTest,
          options: {
            postprocess: 'output.trim()',
          },
          assert: [
            {
              type: 'llm-rubric',
              value: 'Good',
              preprocessors: [{ type: 'xlsx', command: ['node', 'xlsx.js'] }],
            },
            {
              type: 'llm-rubric',
              value: 'Also good',
              postprocess: 'output.trim()',
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected removed fields to be rejected');
    const messages = collectIssueMessages(result.error.issues);
    expect(messages.some((message) => message.includes('preprocessors has been removed'))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes('postprocess has been removed'))).toBe(true);
  });

  it('accepts shared composable graph fields in eval YAML', () => {
    const result = EvalFileSchema.safeParse({
      providers: [
        {
          id: 'openai:codex-app-server',
          label: 'codex-local',
          runtime: 'host',
          config: { command: ['codex', 'app-server'] },
        },
        {
          id: 'openai',
          label: 'openai-grader',
          runtime: 'host',
          config: { model: 'gpt-5-mini' },
        },
      ],
      defaults: {
        provider: 'codex-local',
        grader: 'openai-grader',
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a top-level graders block — a grader is just a provider', () => {
    const result = EvalFileSchema.safeParse({
      providers: [
        {
          id: 'openai:codex-app-server',
          label: 'codex-local',
          runtime: 'host',
          config: { command: ['codex', 'app-server'] },
        },
      ],
      graders: [
        {
          id: 'openai-grader',
          provider: 'openai',
          config: { model: 'gpt-5-mini' },
        },
      ],
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected graders to be rejected');
    const messages = collectIssueMessages(result.error.issues);
    expect(messages.some((message) => message.includes("'graders' has been removed"))).toBe(true);
  });

  it('rejects removed top-level runs and early_exit controls', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      runs: 2,
      early_exit: true,
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('does not model removed workspace env preflight requirements in the public schema', () => {
    const result = EvalFileSchema.safeParse({
      workspace: {
        env: {
          required_commands: ['git'],
          required_python_modules: ['json'],
        },
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts top-level providers and evaluate_options repeat controls with include selection entries', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      description: 'Wrapper eval',
      tags: { experiment: 'release-gate' },
      providers: [{ id: 'agentv:codex-cli', label: 'codex' }],
      threshold: 0.8,
      timeout_seconds: 300,
      evaluate_options: {
        budget_usd: 2,
        max_concurrency: 3,
        repeat: 2,
      },
      tests: [
        {
          ...baseTest,
          options: {
            repeat: 3,
          },
        },
        {
          include: './evals/**/*.eval.yaml',
          type: 'suite',
          select: {
            test_ids: ['pr50857-*'],
            tags: ['sql-migration'],
            metadata: {
              type: ['e2e', 'regression'],
              priority: 'high',
            },
          },
          run: {
            threshold: 1,
            repeat: 2,
            timeout_seconds: 120,
            budget_usd: 2,
          },
        },
        {
          include: './cases/**/*.cases.yaml',
          type: 'tests',
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects top-level experiment strings with a migration hint', () => {
    const result = EvalFileSchema.safeParse({
      experiment: 'release-gate',
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'experiment')).toBe(true);
    expect(JSON.stringify(result.error?.issues)).toContain('tags.experiment');
    expect(JSON.stringify(result.error?.issues)).toContain('CLI --experiment');
  });

  it('accepts Promptfoo-style colon provider specs', () => {
    const result = EvalFileSchema.safeParse({
      name: 'colon-providers',
      prompts: ['{{ prompt }}'],
      providers: [
        'openai:gpt-4.1-mini',
        { id: 'openai:responses:gpt-5.4', label: 'gpt5-responses' },
        { id: 'anthropic:messages:claude-sonnet-4-6' },
        { id: 'exec:node ./provider.js' },
        { id: 'gateway:openai:responses:gpt-5.4' },
      ],
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts Promptfoo provider maps and provider inputs', () => {
    const result = EvalFileSchema.safeParse({
      name: 'promptfoo-provider-maps',
      prompts: ['{{ prompt }}'],
      providers: [
        {
          'openai:gpt-4': {
            label: 'gpt4',
            config: { temperature: 0 },
            inputs: { prompt: 'User prompt text' },
          },
        },
        {
          id: 'openai:gpt-4.1-mini',
          label: 'mini',
          inputs: { prompt: { type: 'text', description: 'User prompt text' } },
        },
      ],
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid evaluate_options.max_concurrency', () => {
    const result = EvalFileSchema.safeParse({
      providers: ['openai:codex'],
      evaluate_options: {
        max_concurrency: 0,
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('accepts default_test.threshold as the preferred inherited test threshold', () => {
    const result = EvalFileSchema.safeParse({
      default_test: {
        threshold: 0.6,
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(true);
  });

  it('accepts default_test file and ref references', () => {
    expect(
      EvalFileSchema.safeParse({
        default_test: 'file://.agentv/default-test.yaml',
        tests: [baseTest],
      }).success,
    ).toBe(true);
    expect(
      EvalFileSchema.safeParse({
        default_test: 'ref://global-default',
        tests: [baseTest],
      }).success,
    ).toBe(true);
  });

  it('rejects bare default_test reference names', () => {
    expect(
      EvalFileSchema.safeParse({
        default_test: 'global-default',
        tests: [baseTest],
      }).success,
    ).toBe(false);
  });

  it('rejects default_test.assertions', () => {
    expect(
      EvalFileSchema.safeParse({
        default_test: {
          assertions: [{ type: 'contains', value: 'ok' }],
        },
        tests: [baseTest],
      }).success,
    ).toBe(false);
  });

  it('accepts a snake_cased promptfoo-shaped eval config', () => {
    const result = EvalFileSchema.safeParse({
      description: 'Promptfoo-compatible authoring shape',
      tags: {
        suite: 'smoke',
      },
      prompts: [
        {
          label: 'reviewer',
          raw: 'Review {{ vars.diff }}',
        },
      ],
      providers: [
        {
          id: 'agentv:codex-cli',
          label: 'local-agent',
          config: {
            command: ['codex'],
            model: 'gpt-5.4-mini',
          },
        },
      ],
      default_test: {
        vars: {
          tone: 'concise',
        },
        assert: ['Mentions the highest-risk issue'],
        options: {
          disable_default_asserts: true,
        },
        threshold: 0.7,
        metadata: {
          priority: 'p0',
        },
      },
      tests: [
        {
          description: 'grades rendered target output',
          vars: {
            diff: 'change',
          },
          assert: [
            {
              type: 'contains',
              value: 'safe',
              metric: 'safety_text',
              threshold: 0.5,
            },
            {
              type: 'llm-rubric',
              value: ['Identifies user impact', 'Avoids unsupported claims'],
              score_ranges: [{ score_range: [0, 10], outcome: 'overall quality' }],
            },
            {
              type: 'assert-set',
              metric: 'grouped_assertions',
              weight: 2,
              config: {
                shared: 'value',
              },
              assert: [{ type: 'contains', value: 'safe', config: { shared: 'child' } }],
              threshold: 0.5,
            },
          ],
          execution: {
            assert: [{ type: 'contains', value: 'Looks' }],
          },
        },
      ],
      scenarios: [
        {
          description: 'severity variants',
          config: [{ vars: { severity: 'high' } }],
          tests: [
            {
              vars: { diff: 'critical fix' },
              assert: [{ type: 'llm-rubric', value: 'Flags the risk clearly' }],
            },
          ],
        },
      ],
      derived_metrics: [{ name: 'weighted_quality', value: 'safety_text * 0.5' }],
      output_path: 'results.json',
      env: {
        EVAL_MODE: 'local',
      },
      nunjucks_filters: {
        slug: './filters/slug.ts',
      },
      extensions: ['agentv:agent-rules'],
      evaluate_options: {
        cache: true,
        delay: 100,
        generate_suggestions: false,
        repeat: 2,
        timeout_ms: 30_000,
        max_eval_time_ms: 120_000,
        filter_range: [0, 10],
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects authored provider_output fields', () => {
    const result = EvalFileSchema.safeParse({
      prompts: ['Review {{ diff }}'],
      tests: [
        {
          vars: { diff: 'change' },
          provider_output: 'Looks safe.',
          assert: [{ type: 'contains', value: 'safe' }],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects composite as an authored assertion grouping type', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [
            {
              type: 'composite',
              assert: [{ type: 'contains', value: 'safe' }],
              aggregator: { type: 'weighted_average' },
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = collectIssueMessages(result.error.issues);
      expect(messages).not.toContain('Invalid literal value, expected "composite"');
    }
  });

  it('accepts promptfoo trajectory assertion types in schema validation', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [
            { type: 'trajectory:tool-used', value: 'search' },
            { type: 'trajectory:tool-args-match', value: { name: 'search', args: { q: 'x' } } },
            { type: 'trajectory:tool-sequence', value: ['search'] },
            { type: 'trajectory:step-count', value: { type: 'tool', min: 1 } },
            { type: 'trajectory:goal-success', value: 'Search for the answer' },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts promptfoo agent-rubric assertions in schema validation', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [
            {
              type: 'agent-rubric',
              value: 'Inspect the workspace and verify the evidence',
              provider: 'codex-grader',
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects public llm-grader assertions with migration guidance', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [
            {
              type: 'llm-grader',
              prompt: 'Judge whether the answer is helpful',
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = collectIssueMessages(result.error.issues);
      expect(
        messages.some(
          (message) =>
            message.includes("Authored assertion type 'llm-grader' has been removed") &&
            message.includes("'llm-rubric'") &&
            message.includes("'agent-rubric'"),
        ),
      ).toBe(true);
    }
  });

  it('rejects stale skill-trigger assertions with migration guidance', () => {
    const positive = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [{ type: 'skill-trigger', skill: 'csv-analyzer', should_trigger: true }],
        },
      ],
    });
    const negative = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [{ type: 'skill-trigger', skill: 'web-search', should_trigger: false }],
        },
      ],
    });

    expect(positive.success).toBe(false);
    expect(negative.success).toBe(false);
    if (!positive.success) {
      expect(collectIssueMessages(positive.error.issues)).toContain(
        "Authored assertion type 'skill-trigger' has been removed. Replace skill: csv-analyzer with type: skill-used, value: csv-analyzer.",
      );
    }
    if (!negative.success) {
      expect(collectIssueMessages(negative.error.issues)).toContain(
        "Authored assertion type 'skill-trigger' has been removed. Replace skill: web-search with type: not-skill-used, value: web-search.",
      );
    }
  });

  it('rejects stale tool-trajectory assertions with migration guidance', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [
            {
              type: 'tool-trajectory',
              mode: 'exact',
              expected: [{ tool: 'search', args: { q: 'agentv' } }, { tool: 'fetch' }],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = collectIssueMessages(result.error.issues);
      expect(messages.some((message) => message.includes('trajectory:tool-sequence'))).toBe(true);
      expect(messages.some((message) => message.includes('trajectory:tool-args-match'))).toBe(true);
    }
  });

  it('rejects stale latency-specific tool-trajectory as unsupported future scope', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [
            {
              type: 'tool-trajectory',
              mode: 'exact',
              expected: [{ tool: 'Read', max_duration_ms: 500 }],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        collectIssueMessages(result.error.issues).some((message) =>
          message.includes('unsupported future scope'),
        ),
      ).toBe(true);
    }
  });

  it('rejects invalid default_test values', () => {
    const invalidThreshold = EvalFileSchema.safeParse({
      default_test: {
        threshold: 1.2,
      },
      tests: [baseTest],
    });
    const unknownDefault = EvalFileSchema.safeParse({
      default_test: {
        threshold: 0.6,
        unsupported: true,
      },
      tests: [baseTest],
    });

    expect(invalidThreshold.success).toBe(false);
    expect(unknownDefault.success).toBe(false);
  });

  it('rejects authored policy blocks', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      policy: {
        runs: 2,
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects top-level model because model belongs in provider config', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      model: 'gpt-5.1',
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('accepts explicit llm-rubric value string shorthand', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          assert: [
            {
              type: 'llm-rubric',
              value: ['Must be polite', 'Must be accurate'],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects top-level imports', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      imports: {
        suites: [
          {
            path: './evals/**/*.eval.yaml',
            select: {
              test_ids: ['pr50857-*'],
              tags: ['sql-migration'],
            },
            run: {
              threshold: 1,
              repeat: 2,
              timeout_seconds: 120,
              budget_usd: 2,
            },
          },
        ],
        tests: [{ path: './cases/**/*.cases.yaml' }, './cases/regressions.jsonl'],
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['imports']);
    expect(result.error?.issues[0]?.message).toContain("Top-level 'imports' is not supported");
    expect(result.error?.issues[0]?.message).toContain('Run eval files directly');
    expect(result.error?.issues[0]?.message).toContain('tests: file://...');
    expect(result.error?.issues[0]?.message).toContain('prompts: file://...');
    expect(result.error?.issues[0]?.message).toContain('default_test: file://...');
    expect(result.error?.issues[0]?.message).toContain('environment: file://...');
    expect(result.error?.issues[0]?.message).toContain('tags');
    expect(result.error?.issues[0]?.message).toContain('CLI multi-file selection');
  });

  it('rejects import-only wrapper evals', () => {
    const result = EvalFileSchema.safeParse({
      name: 'wrapper',
      target: 'codex',
      threshold: 0.8,
      imports: {
        suites: [{ path: './evals/**/*.eval.yaml' }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'imports')).toBe(true);
  });

  it('rejects removed experiment authoring blocks', () => {
    const result = EvalFileSchema.safeParse({
      experiment: { target: 'codex' },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('tags.experiment');
  });

  it('rejects lifecycle commands under authored policy blocks', () => {
    const result = EvalFileSchema.safeParse({
      policy: {
        setup: [{ command: 'bun install' }],
        scripts: ['bun test'],
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects sandbox under authored policy blocks', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      policy: {
        sandbox: 'auto',
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects object-shaped public repeat fields', () => {
    const result = EvalFileSchema.safeParse({
      providers: ['mock-target'],
      evaluate_options: {
        repeat: { count: 2, strategy: 'pass_any', early_exit: true, cost_limit_usd: 1 },
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects camelCase fields under authored policy blocks', () => {
    const result = EvalFileSchema.safeParse({
      target: 'codex',
      policy: {
        timeoutSeconds: 300,
        repeat: { count: 2, costLimitUsd: 1 },
      },
      tests: [baseTest],
    });

    expect(result.success).toBe(false);
  });

  it('rejects scoped run overrides that change the target or setup', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          id: 'case-1',
          vars: { question: 'Question' },
          criteria: 'Goal',
          run: {
            target: 'other-agent',
            setup: [{ command: 'bun install' }],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('does not model removed workspace hook script alias in the public schema', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          workspace: {
            hooks: {
              before_all: {
                script: ['bun', 'run', 'setup.ts'],
              },
            },
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('does not accept test-level execution.targets', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          execution: {
            targets: ['codex'],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected test-level execution.targets to be rejected');
    expect(collectIssueMessages(result.error.issues)).toContain(
      "Unrecognized key(s) in object: 'targets'",
    );
  });

  it('does not accept test-level execution.target', () => {
    const result = EvalFileSchema.safeParse({
      tests: [
        {
          ...baseTest,
          execution: {
            target: 'codex',
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected test-level execution.target to be rejected');
    expect(collectIssueMessages(result.error.issues)).toContain(
      "Unrecognized key(s) in object: 'target'",
    );
  });
});
