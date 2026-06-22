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
  timeout: 30000
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts results field without warnings', async () => {
    const filePath = path.join(tempDir, 'config-results.yaml');
    await writeFile(
      filePath,
      `results:
  repo:
    remote: https://github.com/EntityProcess/agentv-evals.git
    branch: agentv-results
    path: ~/data/agentv-results
  sync:
    auto_push: true
  branch_prefix: eval-results
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
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
    name: AgentV
    repo:
      url: https://github.com/EntityProcess/agentv.git
      branch: main
      path: /srv/agentv
    results:
      repo:
        remote: git@github.com:EntityProcess/agentv-results.git
        branch: agentv-results
        path: /srv/agentv-results
      sync:
        auto_push: true
      branch_prefix: eval-results
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts URL-backed source storage branch results in global project config', async () => {
    const filePath = path.join(tempDir, 'global-config-repo-path.yaml');
    await writeFile(
      filePath,
      `projects:
  - id: agentv
    name: AgentV
    repo:
      url: https://github.com/EntityProcess/agentv.git
      path: /srv/agentv
    results:
      repo:
        remote: https://github.com/EntityProcess/agentv.git
        path: .
        branch: agentv/results/v1
      sync:
        auto_push: false
        require_push: true
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('keeps flat project repo fields compatible with migration warnings', async () => {
    const filePath = path.join(tempDir, 'global-config-flat-project.yaml');
    await writeFile(
      filePath,
      `projects:
  - id: agentv
    name: AgentV
    repo_url: https://github.com/EntityProcess/agentv.git
    path: /srv/agentv
    ref: main
    results:
      repo_url: git@github.com:EntityProcess/agentv-results.git
      branch: agentv-results
      path: /srv/agentv-results
      sync:
        auto_push: true
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', location: 'projects[0].repo_url' }),
        expect.objectContaining({ severity: 'warning', location: 'projects[0].path' }),
        expect.objectContaining({ severity: 'warning', location: 'projects[0].ref' }),
        expect.objectContaining({
          severity: 'warning',
          location: 'projects[0].results.repo_url',
        }),
        expect.objectContaining({ severity: 'warning', location: 'projects[0].results.branch' }),
        expect.objectContaining({ severity: 'warning', location: 'projects[0].results.path' }),
      ]),
    );
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
    name: AgentV
    repo:
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
    name: Misplaced
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

  it('errors on invalid global project entries and nested results config', async () => {
    const filePath = path.join(tempDir, 'global-config-invalid-projects.yaml');
    await writeFile(
      filePath,
      `projects:
  - id: ""
    name: 42
    repo:
      url: EntityProcess/agentv
      path:
      branch: ""
    results:
      repo:
        remote: EntityProcess/results
        branch: ""
        path: repo/subdir
      sync:
        auto_push: yes
      branch_prefix: ""
  - not-an-object
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', location: 'projects[0].id' }),
        expect.objectContaining({ severity: 'error', location: 'projects[0].name' }),
        expect.objectContaining({ severity: 'error', location: 'projects[0].repo.url' }),
        expect.objectContaining({ severity: 'error', location: 'projects[0].repo.path' }),
        expect.objectContaining({ severity: 'error', location: 'projects[0].repo.branch' }),
        expect.objectContaining({
          severity: 'error',
          location: 'projects[0].results.repo.branch',
        }),
        expect.objectContaining({
          severity: 'error',
          location: 'projects[0].results.repo.remote',
        }),
        expect.objectContaining({
          severity: 'error',
          location: 'projects[0].results.sync.auto_push',
        }),
        expect.objectContaining({
          severity: 'error',
          location: 'projects[0].results.branch_prefix',
        }),
        expect.objectContaining({ severity: 'error', location: 'projects[1]' }),
      ]),
    );
  });

  it.each([
    {
      field: 'repository',
      yaml: 'repository: example/repo',
      location: 'projects[0].repository',
      migration: 'repo.url',
    },
    {
      field: 'source',
      yaml: `source:
      url: https://github.com/example/repo
      ref: main`,
      location: 'projects[0].source',
      migration: 'Move',
    },
    {
      field: 'results.mode',
      yaml: `results:
      mode: github
      repo_url: https://github.com/example/results.git`,
      location: 'projects[0].results.mode',
      migration: 'Remove',
    },
    {
      field: 'results.repo',
      yaml: `results:
      repo: example/legacy-results`,
      location: 'projects[0].results.repo',
      migration: 'repo.remote',
    },

    {
      field: 'results.repository',
      yaml: `results:
      repo:
        remote: https://github.com/example/results.git
      repository: example/results`,
      location: 'projects[0].results.repository',
      migration: 'repo.remote',
    },
    {
      field: 'results.local_path',
      yaml: `results:
      repo:
        remote: https://github.com/example/results.git
      local_path: /srv/results`,
      location: 'projects[0].results.local_path',
      migration: 'path',
    },
    {
      field: 'results.auto_push',
      yaml: `results:
      repo:
        remote: https://github.com/example/results.git
      auto_push: true`,
      location: 'projects[0].results.auto_push',
      migration: 'sync.auto_push',
    },
  ])('errors on removed legacy project field $field with migration guidance', async (legacy) => {
    const filePath = path.join(tempDir, `global-config-legacy-${legacy.field}.yaml`);
    await writeFile(
      filePath,
      `projects:
  - id: legacy
    name: Legacy
    repo:
      url: https://github.com/example/repo.git
      path: /srv/legacy
      branch: main
    ${legacy.yaml}
`,
    );

    const result = await validateConfigFile(filePath, { scope: 'global' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: legacy.location,
      }),
    );
    expect(result.errors.find((e) => e.location === legacy.location)?.message).toContain(
      legacy.migration,
    );
  });

  it('warns on deprecated results_by_project', async () => {
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
        location: 'results_by_project',
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
  repo:
    path: .
    branch: agentv/results/v1
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('keeps flat top-level results compatible with migration warnings', async () => {
    const filePath = path.join(tempDir, 'config-results-flat-compatible.yaml');
    await writeFile(
      filePath,
      `results:
  repo_url: https://github.com/EntityProcess/agentv-evals.git
  branch: agentv-results
  path: ~/data/agentv-results
  sync:
    auto_push: true
`,
    );

    const result = await validateConfigFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', location: 'results.repo_url' }),
        expect.objectContaining({ severity: 'warning', location: 'results.branch' }),
        expect.objectContaining({ severity: 'warning', location: 'results.path' }),
      ]),
    );
  });

  it('errors on old-style subdirectory path', async () => {
    const filePath = path.join(tempDir, 'config-results-old-path.yaml');
    await writeFile(
      filePath,
      `results:
  mode: github
  repo: EntityProcess/agentv-evals
  path: autopilot-dev/runs
`,
    );

    const result = await validateConfigFile(filePath);

    const fieldErrors = result.errors.filter(
      (e) => e.severity === 'error' && e.location === 'results.path',
    );
    expect(fieldErrors).toHaveLength(1);
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
});
