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
});
