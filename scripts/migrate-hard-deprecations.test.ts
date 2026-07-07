import { describe, expect, it } from 'bun:test';
import { parse } from 'yaml';

import { _internal } from './migrate-hard-deprecations.ts';

function migrateSnippet(source: string): string {
  const migrated = _internal.migrateYamlSnippet(source, '/tmp/suite.eval.yaml');
  if (migrated === undefined) {
    throw new Error('expected snippet to migrate');
  }
  return migrated;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected object');
  }
  return value as Record<string, unknown>;
}

describe('migrate-hard-deprecations', () => {
  it('migrates suite execution, artifact, and workspace legacy keys', () => {
    const migrated = migrateSnippet(`description: legacy
execution:
  workers: 4
workspace:
  isolation: per_case
  repos:
    - path: ./repo
      repo: https://github.com/org/repo.git
results:
  timing_path: .agentv/results/run/timing.json
  manifest_path: .agentv/results/run/manifest.json
results_jsonl:
  manifest_path: .agentv/results/run/manifest.jsonl
tests:
  - id: one
    vars:
      input: hi
`);
    const parsed = parse(migrated) as Record<string, unknown>;

    expect(parsed.execution).toBeUndefined();
    expect(parsed.evaluate_options).toEqual({ max_concurrency: 4 });
    expect(parsed.workspace).toEqual({
      scope: 'attempt',
      repos: [{ path: './repo', repo: 'https://github.com/org/repo.git' }],
    });
    expect(parsed.results).toEqual({
      metrics_path: '.agentv/results/run/metrics.json',
      index_path: '.agentv/results/run/index.jsonl',
    });
    expect(parsed.results_jsonl).toEqual({
      index_path: '.agentv/results/run/index.jsonl',
    });
  });

  it('migrates legacy env templates while preserving shell-time command variables', () => {
    const parsed = parse(`targets:
  - id: cli
    provider: cli
    command: echo $FOO \${BAR}
    cwd: \${{ WORKSPACE_DIR }}
    args:
      - \${{ CODEX_MODEL }}
`) as unknown;

    expect(_internal.migrateYamlValue(parsed, '/tmp/targets.yaml')).toBe(true);
    expect(parsed).toEqual({
      providers: [
        {
          id: 'cli',
          label: 'cli',
          command: 'echo $FOO ${BAR}',
          cwd: '{{ env.WORKSPACE_DIR }}',
          args: ['{{ env.CODEX_MODEL }}'],
        },
      ],
    });
  });

  it('migrates postprocess and preprocessors to Promptfoo-compatible transform fields', () => {
    const migrated = migrateSnippet(`preprocessors:
  - type: xlsx
    command:
      - bun
      - scripts/xlsx.ts
default_test:
  vars:
    topic: revenue
prompts:
  - "{{ input }}"
tests:
  - id: one
    options:
      postprocess: output.toUpperCase()
    assert:
      - type: llm-rubric
        value: ok
        postprocess: output.trim()
      - type: llm-rubric
        value: also ok
        preprocessors:
          - type: xlsx
            command:
              - node
              - xlsx.js
    vars:
      input: hi
`);
    const parsed = asRecord(parse(migrated));
    const defaultTest = asRecord(parsed.default_test);
    const defaultOptions = asRecord(defaultTest.options);
    const tests = parsed.tests as Array<Record<string, unknown>>;
    const firstTest = asRecord(tests[0]);
    const firstTestOptions = asRecord(firstTest.options);
    const assertions = firstTest.assert as Array<Record<string, unknown>>;
    const firstAssertion = asRecord(assertions[0]);
    const secondAssertion = asRecord(assertions[1]);

    expect(parsed.preprocessors).toBeUndefined();
    expect(defaultOptions.postprocess).toBeUndefined();
    expect(defaultOptions.transform).toContain('return (() =>');
    expect(defaultOptions.transform).toContain('Bun.spawnSync(["bun","scripts/xlsx.ts"]');
    expect(firstTestOptions).toEqual({ transform: 'output.toUpperCase()' });
    expect(firstAssertion).toMatchObject({ transform: 'output.trim()' });
    expect(firstAssertion.postprocess).toBeUndefined();
    expect(secondAssertion.preprocessors).toBeUndefined();
    expect(secondAssertion.transform).toContain('return (() =>');
    expect(secondAssertion.transform).toContain('Bun.spawnSync(["node","xlsx.js"]');
  });

  it('migrates target-shaped authoring to provider-shaped authoring', () => {
    const migrated = migrateSnippet(`targets:
  - id: codex-host
    provider: codex-cli
    runtime: host
    config:
      model: gpt-5-codex
  - id: grader-gpt5-mini
    provider: openai
defaults:
  target: codex-host
  grader: grader-gpt5-mini
prompts:
  - "{{ input }}"
tests:
  - id: one
    vars:
      input: Fix the bug
    assert:
      - type: llm-rubric
        value: ok
        target: grader-gpt5-mini
`);
    const parsed = asRecord(parse(migrated));
    const providers = parsed.providers as Array<Record<string, unknown>>;
    const defaults = asRecord(parsed.defaults);
    const tests = parsed.tests as Array<Record<string, unknown>>;
    const assertions = tests[0].assert as Array<Record<string, unknown>>;

    expect(parsed.targets).toBeUndefined();
    expect(providers).toEqual([
      {
        id: 'codex-cli',
        label: 'codex-host',
        runtime: 'host',
        config: { model: 'gpt-5-codex' },
      },
      {
        id: 'openai',
        label: 'grader-gpt5-mini',
      },
    ]);
    expect(defaults.target).toBeUndefined();
    expect(defaults.provider).toBe('codex-host');
    expect(assertions[0]).toEqual({
      type: 'llm-rubric',
      value: 'ok',
      provider: 'grader-gpt5-mini',
    });
  });

  it('migrates suite target refs and targets file refs to providers', () => {
    const migrated = migrateSnippet(`targets: file://.agentv/targets.yaml
prompts:
  - "{{ input }}"
tests:
  - id: one
    vars:
      input: hi
`);
    const parsed = asRecord(parse(migrated));

    expect(parsed.targets).toBeUndefined();
    expect(parsed.providers).toBe('file://.agentv/providers.yaml');
  });

  it('migrates standalone defaults target to provider', () => {
    const migrated = _internal.migrateYamlSnippet(
      `target: local-openai
grader: local-openai-grader
`,
      '/tmp/defaults.yaml',
    );

    expect(parse(migrated ?? '')).toEqual({
      provider: 'local-openai',
      grader: 'local-openai-grader',
    });
  });

  it('migrates authored expected_output to vars.expected_output with explicit rubric assertion', () => {
    const migrated = migrateSnippet(`description: legacy expected output
prompts:
  - "{{ input }}"
tests:
  - id: one
    vars:
      input: What is 2+2?
    expected_output: "4"
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;
    const firstTest = asRecord(tests[0]);
    const vars = asRecord(firstTest.vars);
    const assertions = firstTest.assert as Array<Record<string, unknown>>;

    expect(firstTest.expected_output).toBeUndefined();
    expect(vars.expected_output).toBe('4');
    expect(assertions).toEqual([
      {
        type: 'llm-rubric',
        value: 'Matches the reference answer: {{ expected_output }}',
      },
    ]);
  });

  it('preserves explicit assert strategy when migrating expected_output', () => {
    const migrated = migrateSnippet(`prompts:
  - "{{ input }}"
tests:
  - id: one
    vars:
      input: What is 2+2?
    expected_output: "4"
    assert:
      - type: equals
        value: "{{ expected_output }}"
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;
    const firstTest = asRecord(tests[0]);
    const vars = asRecord(firstTest.vars);
    const assertions = firstTest.assert as Array<Record<string, unknown>>;

    expect(firstTest.expected_output).toBeUndefined();
    expect(vars.expected_output).toBe('4');
    expect(assertions).toEqual([{ type: 'equals', value: '{{ expected_output }}' }]);
  });

  it('migrates default_test expected_output to default_test.vars.expected_output', () => {
    const migrated = migrateSnippet(`default_test:
  expected_output: Paris
prompts:
  - "{{ input }}"
tests:
  - id: one
    vars:
      input: What is the capital of France?
`);
    const parsed = asRecord(parse(migrated));
    const defaultTest = asRecord(parsed.default_test);
    const vars = asRecord(defaultTest.vars);
    const assertions = defaultTest.assert as Array<Record<string, unknown>>;

    expect(defaultTest.expected_output).toBeUndefined();
    expect(vars.expected_output).toBe('Paris');
    expect(assertions[0]).toEqual({
      type: 'llm-rubric',
      value: 'Matches the reference answer: {{ expected_output }}',
    });
  });

  it('migrates skill-trigger assertions to promptfoo skill assertions', () => {
    const migrated = migrateSnippet(`prompts:
  - "{{ input }}"
tests:
  - id: expected-skill
    assert:
      - type: skill-trigger
        skill: csv-analyzer
        should_trigger: true
    vars:
      input: Analyze the CSV
  - id: forbidden-skill
    assert:
      - type: skill-trigger
        skill: web-search
        should_trigger: false
    vars:
      input: Do not search the web
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;

    expect(tests[0].assert).toEqual([{ type: 'skill-used', value: 'csv-analyzer' }]);
    expect(tests[1].assert).toEqual([{ type: 'not-skill-used', value: 'web-search' }]);
  });

  it('migrates snake_case skill_trigger assertions to promptfoo skill assertions', () => {
    const migrated = migrateSnippet(`prompts:
  - "{{ input }}"
tests:
  - id: expected-skill
    assert:
      - type: skill_trigger
        skill: csv-analyzer
        should_trigger: true
  - id: forbidden-skill
    assert:
      - type: skill_trigger
        skill: web-search
        should_trigger: false
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;

    expect(tests[0].assert).toEqual([{ type: 'skill-used', value: 'csv-analyzer' }]);
    expect(tests[1].assert).toEqual([{ type: 'not-skill-used', value: 'web-search' }]);
  });

  it('migrates any_order tool-trajectory minimums to trajectory:tool-used assertions', () => {
    const migrated = migrateSnippet(`prompts:
  - "{{ input }}"
tests:
  - id: tools
    assert:
      - metric: tool-presence
        type: tool-trajectory
        mode: any_order
        minimums:
          search: 2
          fetch: 1
    vars:
      input: Research the topic
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;
    const assertions = tests[0].assert as Array<Record<string, unknown>>;

    expect(assertions).toEqual([
      {
        metric: 'tool-presence',
        type: 'trajectory:tool-used',
        value: { name: 'search', min: 2 },
      },
      {
        type: 'trajectory:tool-used',
        value: { name: 'fetch', min: 1 },
      },
    ]);
  });

  it('migrates snake_case tool_trajectory minimums to trajectory:tool-used assertions', () => {
    const migrated = migrateSnippet(`prompts:
  - "{{ input }}"
tests:
  - id: tools
    assert:
      - metric: tool-presence
        type: tool_trajectory
        mode: any_order
        minimums:
          search: 2
    vars:
      input: Research the topic
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;

    expect(tests[0].assert).toEqual([
      {
        metric: 'tool-presence',
        type: 'trajectory:tool-used',
        value: { name: 'search', min: 2 },
      },
    ]);
  });

  it('migrates ordered tool-trajectory steps and args to promptfoo trajectory assertions', () => {
    const migrated = migrateSnippet(`prompts:
  - "{{ input }}"
tests:
  - id: tools
    assert:
      - metric: tool-flow
        type: tool-trajectory
        mode: exact
        expected:
          - tool: search
            args:
              q: agentv
            args_match: exact
          - tool: fetch
            args: any
    vars:
      input: Research AgentV
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;
    const assertions = tests[0].assert as Array<Record<string, unknown>>;

    expect(assertions).toEqual([
      {
        metric: 'tool-flow',
        type: 'trajectory:tool-sequence',
        value: { mode: 'exact', steps: ['search', 'fetch'] },
      },
      {
        type: 'trajectory:tool-args-match',
        value: { name: 'search', args: { q: 'agentv' }, mode: 'exact' },
      },
    ]);
  });

  it('migrates snake_case tool_trajectory ordered steps and args to promptfoo trajectory assertions', () => {
    const migrated = migrateSnippet(`prompts:
  - "{{ input }}"
tests:
  - id: tools
    assert:
      - metric: tool-flow
        type: tool_trajectory
        mode: in_order
        expected:
          - tool: search
            args:
              q: agentv
          - tool: fetch
            args: any
    vars:
      input: Research AgentV
`);
    const parsed = asRecord(parse(migrated));
    const tests = parsed.tests as Array<Record<string, unknown>>;
    const assertions = tests[0].assert as Array<Record<string, unknown>>;

    expect(assertions).toEqual([
      {
        metric: 'tool-flow',
        type: 'trajectory:tool-sequence',
        value: { mode: 'in_order', steps: ['search', 'fetch'] },
      },
      {
        type: 'trajectory:tool-args-match',
        value: { name: 'search', args: { q: 'agentv' }, mode: 'partial' },
      },
    ]);
  });

  it('leaves latency-specific tool-trajectory assertions for explicit rejection', () => {
    const parsed = parse(`prompts:
  - "{{ input }}"
tests:
  - id: latency
    assert:
      - type: tool-trajectory
        mode: exact
        expected:
          - tool: Read
            max_duration_ms: 500
    vars:
      input: Read quickly
`) as unknown;

    expect(_internal.migrateYamlValue(parsed, '/tmp/suite.eval.yaml')).toBe(false);
  });
});
