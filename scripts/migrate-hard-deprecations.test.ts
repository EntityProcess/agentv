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
      index_path: '.agentv/results/run/manifest.json',
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
      targets: [
        {
          id: 'cli',
          provider: 'cli',
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
});
