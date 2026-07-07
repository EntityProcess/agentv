import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateConfigFile } from '../../../src/evaluation/validation/config-validator.js';

describe('validateConfigFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-config-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts required_version field without warnings', async () => {
    const filePath = path.join(tempDir, 'config.yaml');
    await writeFile(
      filePath,
      `required_version: ">=3.1.0"
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts execution field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-exec.yaml');
    await writeFile(
      filePath,
      `execution:
  max_concurrency: 3
  verbose: true
  keep_workspaces: false
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects execution.workers in config graph execution policy', async () => {
    const filePath = path.join(tempDir, 'config-execution-workers.yaml');
    await writeFile(
      filePath,
      `execution:
  workers: 3
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('execution.workers'),
      }),
    );
  });

  it('accepts composable config graph fields and direct file refs', async () => {
    const graphDir = path.join(tempDir, 'composable-config');
    const filePath = path.join(graphDir, '.agentv', 'config.yaml');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      [
        'providers: file://providers.yaml',
        'tests: file://tests.yaml',
        'defaults: file://defaults.yaml',
        'execution: file://execution.yaml',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(path.dirname(filePath), 'providers.yaml'),
      [
        '- id: openai:codex-app-server',
        '  label: codex-local',
        '  runtime: host',
        '  config:',
        '    command: ["codex", "app-server"]',
        '- id: openai',
        '  label: openai-grader',
        '  runtime: host',
        '  config: {}',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(path.dirname(filePath), 'tests.yaml'),
      ['- id: smoke', '  input: Fix the failing test', ''].join('\n'),
    );
    await writeFile(
      path.join(path.dirname(filePath), 'defaults.yaml'),
      ['provider: codex-local', 'grader: openai-grader', ''].join('\n'),
    );
    await writeFile(path.join(path.dirname(filePath), 'execution.yaml'), 'max_concurrency: 3\n');

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects removed composable config target fields and dashboard.app_name', async () => {
    const filePath = path.join(tempDir, 'config-invalid-composable.yaml');
    await writeFile(
      filePath,
      [
        'providers:',
        '  - name: codex-local',
        '    id: codex',
        '    runtime: host',
        '    executable: codex',
        '    config: {}',
        'dashboard:',
        '  app_name: Custom AgentV',
        '',
      ].join('\n'),
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('name'),
        }),
        expect.objectContaining({
          severity: 'error',
          location: 'dashboard.app_name',
        }),
      ]),
    );
  });

  it('rejects wrapped referenced config field files', async () => {
    const graphDir = path.join(tempDir, 'wrapped-composable-config');
    const filePath = path.join(graphDir, '.agentv', 'config.yaml');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'providers: file://providers.yaml\n');
    await writeFile(
      path.join(path.dirname(filePath), 'providers.yaml'),
      ['providers:', '  - id: openai:codex-app-server', '    label: codex-local', ''].join('\n'),
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining("wrapped in 'providers'"),
      }),
    );
  });

  it('accepts results field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-results.yaml');
    await writeFile(
      filePath,
      `results:
  repo: https://github.com/EntityProcess/agentv-evals.git
  branch: agentv-results
  path: ~/data/agentv-results
  auto_push: true
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects redundant results mode in project config', async () => {
    const filePath = path.join(tempDir, 'config-results-mode.yaml');
    await writeFile(
      filePath,
      `results:
  mode: github
  path: .
  branch: agentv/results/v1
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'results.mode',
        message: "Remove 'results.mode'; results use 'results.repo' and 'results.path'.",
      }),
    );
  });

  it('accepts repo_resolvers field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-repo-resolvers.yaml');
    await writeFile(
      filePath,
      `repo_resolvers:
  - name: org_snapshots
    repos:
      - https://github.com/example/*
    command:
      - bun
      - scripts/repo-resolver.ts
    config:
      release_tag: snapshot/v1
  - name: default
    command:
      - bun
      - scripts/default-repo-resolver.ts
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts refs field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-refs.yaml');
    await writeFile(
      filePath,
      `refs:
  global-default: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on invalid refs config', async () => {
    const filePath = path.join(tempDir, 'config-invalid-refs.yaml');
    await writeFile(
      filePath,
      `refs:
  empty:
  count: 3
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', location: 'refs.empty' }),
        expect.objectContaining({ severity: 'error', location: 'refs.count' }),
      ]),
    );
  });

  it('errors on invalid repo_resolvers config', async () => {
    const filePath = path.join(tempDir, 'config-invalid-repo-resolvers.yaml');
    await writeFile(
      filePath,
      `repo_resolvers:
  - name: duplicate
    command: []
  - name: duplicate
    command:
      - bun
  - name: default
    repos:
      - https://github.com/example/*
    command:
      - bun
    config: []
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', location: 'repo_resolvers[0].command' }),
        expect.objectContaining({ severity: 'error', location: 'repo_resolvers[1].name' }),
        expect.objectContaining({ severity: 'error', location: 'repo_resolvers[2].repos' }),
        expect.objectContaining({ severity: 'error', location: 'repo_resolvers[2].config' }),
      ]),
    );
  });

  it('accepts dashboard field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-dashboard.yaml');
    await writeFile(
      filePath,
      `dashboard:
  threshold: 0.8
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts projects field in global config', async () => {
    const filePath = path.join(tempDir, 'global-config.yaml');
    await writeFile(
      filePath,
      `projects:
  - id: agentv
    repo: https://github.com/EntityProcess/agentv.git
    path: /srv/agentv
    branch: main
    results:
      repo: git@github.com:EntityProcess/agentv-results.git
      branch: agentv-results
      path: /srv/agentv-results
      auto_push: true
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('infers AGENTV_HOME config.local.yaml as global', async () => {
    const previousAgentvHome = process.env.AGENTV_HOME;
    const homeDir = path.join(tempDir, 'agentv-home-local');
    const filePath = path.join(homeDir, 'config.local.yaml');
    await mkdir(homeDir, { recursive: true });
    await writeFile(
      filePath,
      `projects:
  - id: agentv
    path: /srv/agentv
    added_at: "2026-01-01T00:00:00Z"
    last_opened_at: "2026-01-01T00:00:00Z"
`,
    );

    try {
      process.env.AGENTV_HOME = homeDir;
      const result = await validateConfigFile(filePath);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    } finally {
      if (previousAgentvHome === undefined) process.env.AGENTV_HOME = undefined;
      else process.env.AGENTV_HOME = previousAgentvHome;
    }
  });

  it('accepts URL-backed source storage branch results in global project config', async () => {
    const filePath = path.join(tempDir, 'global-config-repo-path.yaml');
    await writeFile(
      filePath,
      `projects:
  - id: agentv
    repo: https://github.com/EntityProcess/agentv.git
    path: /srv/agentv
    results:
      repo: https://github.com/EntityProcess/agentv.git
      path: .
      branch: agentv/results/v1
      auto_push: false
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('infers AGENTV_HOME config.yaml as global even when the home dir is named .agentv', async () => {
    const fakeHome = path.join(tempDir, 'fake-user-home');
    const homeConfigDir = path.join(fakeHome, '.agentv');
    const filePath = path.join(homeConfigDir, 'config.yaml');
    await mkdir(homeConfigDir, { recursive: true });
    await writeFile(
      filePath,
      `projects:
  - id: agentv
    path: /srv/agentv
`,
    );

    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(fakeHome);
    try {
      const result = await validateConfigFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it('warns when projects field appears in project-local config', async () => {
    const projectDir = path.join(tempDir, 'project-with-projects-field');
    const filePath = path.join(projectDir, '.agentv', 'config.yaml');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `projects:
  - id: misplaced
    path: /srv/misplaced
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        location: 'projects',
      }),
    );
  });

  it('errors on invalid global project entries and flat results config', async () => {
    const filePath = path.join(tempDir, 'global-config-invalid-projects.yaml');
    await writeFile(
      filePath,
      `projects:
  - id: ""
    repo: 99
    path: ""
    branch: ""
    results:
      repo: ""
      branch: ""
      auto_push: maybe
  - not-an-object
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', location: 'projects[0].id' }),
        expect.objectContaining({ severity: 'error', location: 'projects[0].repo' }),
        expect.objectContaining({ severity: 'error', location: 'projects[0].path' }),
        expect.objectContaining({ severity: 'error', location: 'projects[0].branch' }),
        expect.objectContaining({
          severity: 'error',
          location: 'projects[0].results.repo',
        }),
        expect.objectContaining({
          severity: 'error',
          location: 'projects[0].results.branch',
        }),
        expect.objectContaining({
          severity: 'error',
          location: 'projects[0].results.auto_push',
        }),
        expect.objectContaining({ severity: 'error', location: 'projects[1]' }),
      ]),
    );
  });

  it('treats removed results_by_project as an unexpected field', async () => {
    const filePath = path.join(tempDir, 'deprecated-results-by-project.yaml');
    await writeFile(
      filePath,
      `results_by_project:
  agentv:
    mode: github
    repo: EntityProcess/agentv-results
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(true);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: 'Unexpected fields: results_by_project',
      }),
    );
  });

  it('accepts legacy studio field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-studio.yaml');
    await writeFile(
      filePath,
      `studio:
  threshold: 0.8
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts top-level results without mode', async () => {
    const filePath = path.join(tempDir, 'config-results-no-mode.yaml');
    await writeFile(
      filePath,
      `results:
  path: .
  branch: agentv/results/v1
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on invalid required_version type', async () => {
    const filePath = path.join(tempDir, 'config-bad-version.yaml');
    await writeFile(filePath, 'required_version: 3\n');

    const result = await validateConfigFile(filePath);

    const fieldErrors = result.errors.filter(
      (e) => e.severity === 'error' && e.location === 'required_version',
    );
    expect(fieldErrors).toHaveLength(1);
  });

  it('warns on truly unexpected fields', async () => {
    const filePath = path.join(tempDir, 'config-unexpected.yaml');
    await writeFile(filePath, 'foo: bar\n');

    const result = await validateConfigFile(filePath);

    const warnings = result.errors.filter((e) => e.severity === 'warning');
    expect(warnings.some((e) => e.message.includes('Unexpected fields: foo'))).toBe(true);
  });

  it('accepts hooks.before_session with a deprecation warning, not an unexpected field', async () => {
    const filePath = path.join(tempDir, 'config-hooks.yaml');
    await writeFile(
      filePath,
      `hooks:
  before_session: "bun scripts/load-secrets.ts"
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.message.includes('Unexpected fields'))).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ severity: 'warning', location: 'hooks.before_session' }),
    );
  });

  it('accepts env_path as a string or array without unexpected-field warnings', async () => {
    const filePath = path.join(tempDir, 'config-env-path.yaml');
    await writeFile(
      filePath,
      `env_path:
  - .env
  - .env.local
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.message.includes('Unexpected fields'))).toBe(false);
  });

  it('accepts env_from as an object or array of argv command entries', async () => {
    const filePath = path.join(tempDir, 'config-env-from.yaml');
    await writeFile(
      filePath,
      `env_from:
  - command: ["bun", "scripts/load-secrets.ts"]
    format: shell_exports
  - command: ["node", "scripts/print-env-json.mjs"]
    format: json
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects env_from.command given as a shell string', async () => {
    const filePath = path.join(tempDir, 'config-env-from-shell-string.yaml');
    await writeFile(
      filePath,
      `env_from:
  command: "bun scripts/load-secrets.ts"
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ severity: 'error', location: 'env_from.command' }),
    );
  });

  it('rejects an invalid env_from.format value', async () => {
    const filePath = path.join(tempDir, 'config-env-from-bad-format.yaml');
    await writeFile(
      filePath,
      `env_from:
  command: ["bun", "x.ts"]
  format: yaml
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ severity: 'error', location: 'env_from.format' }),
    );
  });

  it('accepts empty env_path/env_from/hooks keys the same way the loader treats them as absent', async () => {
    const filePath = path.join(tempDir, 'config-empty-env-keys.yaml');
    await writeFile(
      filePath,
      `env_path:
env_from:
hooks:
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
