import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('Workspace config parsing', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `agentv-ws-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should parse per-case workspace config with before_all and after_each scripts', async () => {
    const evalFile = path.join(testDir, 'workspace-case.yaml');
    await writeFile(
      evalFile,
      `
tests:
  - id: test-case-1
    input: "Do something"
    criteria: "Should do the thing"
    workspace:
      before_all:
        script: ["bun", "run", "setup.ts"]
        timeout_ms: 120000
      after_each:
        script: ["bun", "run", "teardown.ts"]
        timeout_ms: 30000
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace).toBeDefined();
    expect(cases[0].workspace?.before_all).toEqual({
      command: ['bun', 'run', 'setup.ts'],
      timeout_ms: 120000,
    });
    expect(cases[0].workspace?.after_each).toEqual({
      command: ['bun', 'run', 'teardown.ts'],
      timeout_ms: 30000,
    });
  });

  it('should parse per-case metadata', async () => {
    const evalFile = path.join(testDir, 'metadata-case.yaml');
    await writeFile(
      evalFile,
      `
tests:
  - id: sympy-20590
    input: "Fix the bug"
    criteria: "Bug should be fixed"
    metadata:
      repo: sympy/sympy
      base_commit: "abc123def"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].metadata).toEqual({
      repo: 'sympy/sympy',
      base_commit: 'abc123def',
    });
  });

  it('should parse suite-level workspace config as default', async () => {
    const evalFile = path.join(testDir, 'workspace-suite.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  before_all:
    script: ["bun", "run", "default-setup.ts"]

tests:
  - id: case-1
    input: "Do something"
    criteria: "Should work"
  - id: case-2
    input: "Do something else"
    criteria: "Should also work"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(2);
    // Both cases should inherit suite-level workspace
    expect(cases[0].workspace?.before_all).toEqual({
      command: ['bun', 'run', 'default-setup.ts'],
    });
    expect(cases[1].workspace?.before_all).toEqual({
      command: ['bun', 'run', 'default-setup.ts'],
    });
  });

  it('should merge case-level workspace with suite-level (case replaces scripts)', async () => {
    const evalFile = path.join(testDir, 'workspace-merge.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  before_all:
    script: ["bun", "run", "default-setup.ts"]

tests:
  - id: case-override
    input: "Do something"
    criteria: "Should work"
    workspace:
      before_all:
        script: ["bun", "run", "custom-setup.ts"]
  - id: case-default
    input: "Do something else"
    criteria: "Should work"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(2);

    // case-override: before_all replaced
    const overrideCase = cases.find((c) => c.id === 'case-override');
    expect(overrideCase).toBeDefined();
    expect(overrideCase.workspace?.before_all).toEqual({
      command: ['bun', 'run', 'custom-setup.ts'],
    });

    // case-default: inherits suite-level workspace entirely
    const defaultCase = cases.find((c) => c.id === 'case-default');
    expect(defaultCase).toBeDefined();
    expect(defaultCase.workspace?.before_all).toEqual({
      command: ['bun', 'run', 'default-setup.ts'],
    });
  });

  it('should inherit pool settings from suite-level workspace when case-level workspace is present', async () => {
    const evalFile = path.join(testDir, 'workspace-pool-inherit.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  pool: false
  pool_clean: full
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git

tests:
  - id: case-override-script
    input: "Do something"
    criteria: "Should work"
    workspace:
      before_all:
        script: ["bun", "run", "custom-setup.ts"]
  - id: case-default
    input: "Do something else"
    criteria: "Should also work"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(2);

    const overrideCase = cases.find((c) => c.id === 'case-override-script');
    expect(overrideCase).toBeDefined();
    expect(overrideCase.workspace?.pool).toBe(false);
    expect(overrideCase.workspace?.pool_clean).toBe('full');
    expect(overrideCase.workspace?.repos).toHaveLength(1);
    expect(overrideCase.workspace?.before_all).toEqual({
      command: ['bun', 'run', 'custom-setup.ts'],
    });

    const defaultCase = cases.find((c) => c.id === 'case-default');
    expect(defaultCase).toBeDefined();
    expect(defaultCase.workspace?.pool).toBe(false);
    expect(defaultCase.workspace?.pool_clean).toBe('full');
  });

  it('should allow case-level workspace to override suite-level pool settings', async () => {
    const evalFile = path.join(testDir, 'workspace-pool-override.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  pool: true
  pool_clean: standard

tests:
  - id: case-disable-pool
    input: "Do something"
    criteria: "Should work"
    workspace:
      pool: false
      pool_clean: full
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace?.pool).toBe(false);
    expect(cases[0].workspace?.pool_clean).toBe('full');
  });

  it('should parse and merge workspace mode and retention settings', async () => {
    const evalFile = path.join(testDir, 'workspace-mode-retention.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  mode: pooled
  reset_clean: full
  retention:
    on_success: cleanup
    on_failure: keep

tests:
  - id: case-retain-override
    input: "Do something"
    criteria: "Should work"
    workspace:
      retention:
        on_failure: cleanup
  - id: case-default
    input: "Do something else"
    criteria: "Should also work"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(2);

    const overrideCase = cases.find((c) => c.id === 'case-retain-override');
    expect(overrideCase?.workspace?.mode).toBe('pooled');
    expect(overrideCase?.workspace?.reset_clean).toBe('full');
    expect(overrideCase?.workspace?.retention?.on_success).toBe('cleanup');
    expect(overrideCase?.workspace?.retention?.on_failure).toBe('cleanup');

    const defaultCase = cases.find((c) => c.id === 'case-default');
    expect(defaultCase?.workspace?.mode).toBe('pooled');
    expect(defaultCase?.workspace?.reset_clean).toBe('full');
    expect(defaultCase?.workspace?.retention?.on_success).toBe('cleanup');
    expect(defaultCase?.workspace?.retention?.on_failure).toBe('keep');
  });

  it('should resolve before_all cwd relative to eval file directory', async () => {
    const evalFile = path.join(testDir, 'workspace-cwd.yaml');
    await writeFile(
      evalFile,
      `
tests:
  - id: test-cwd
    input: "Do something"
    criteria: "Should work"
    workspace:
      before_all:
        script: ["bun", "run", "setup.ts"]
        cwd: ./scripts
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace?.before_all?.cwd).toBe(path.join(testDir, 'scripts'));
  });

  it('should parse workspace template path', async () => {
    const evalFile = path.join(testDir, 'workspace-template.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  template: ./workspace-template

tests:
  - id: test-template
    input: "Do something"
    criteria: "Should work"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace?.template).toBe(path.join(testDir, 'workspace-template'));
  });

  it('parses workspace repos from YAML', async () => {
    const evalFile = path.join(testDir, 'workspace-repos.yaml');
    await writeFile(
      evalFile,
      `
description: test
workspace:
  repos:
    - path: ./repo-a
      source:
        type: git
        url: https://github.com/org/repo.git
      checkout:
        ref: main
        resolve: remote
        ancestor: 1
      clone:
        depth: 2
        filter: blob:none
        sparse:
          - src/**
tests:
  - id: test-1
    input: "hello"
    criteria: "world"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    const workspace = cases[0].workspace;
    expect(workspace?.repos).toHaveLength(1);
    expect(workspace?.repos?.[0].path).toBe('./repo-a');
    expect(workspace?.repos?.[0].source).toEqual({
      type: 'git',
      url: 'https://github.com/org/repo.git',
    });
    expect(workspace?.repos?.[0].checkout?.ref).toBe('main');
    expect(workspace?.repos?.[0].checkout?.resolve).toBe('remote');
    expect(workspace?.repos?.[0].checkout?.ancestor).toBe(1);
    expect(workspace?.repos?.[0].clone?.depth).toBe(2);
    expect(workspace?.repos?.[0].clone?.filter).toBe('blob:none');
    expect(workspace?.repos?.[0].clone?.sparse).toEqual(['src/**']);
  });

  it('parses workspace reset config', async () => {
    const evalFile = path.join(testDir, 'workspace-reset.yaml');
    await writeFile(
      evalFile,
      `
description: test
workspace:
  reset:
    strategy: hard
    after_each: true
tests:
  - id: test-1
    input: "hello"
    criteria: "world"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].workspace?.reset?.strategy).toBe('hard');
    expect(cases[0].workspace?.reset?.after_each).toBe(true);
  });

  it('parses workspace isolation field', async () => {
    const evalFile = path.join(testDir, 'workspace-isolation.yaml');
    await writeFile(
      evalFile,
      `
description: test
workspace:
  isolation: per_test
  repos:
    - path: ./repo-a
      source:
        type: git
        url: https://github.com/org/repo.git
tests:
  - id: test-1
    input: "hello"
    criteria: "world"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].workspace?.isolation).toBe('per_test');
  });

  it('should handle case with no workspace config', async () => {
    const evalFile = path.join(testDir, 'no-workspace.yaml');
    await writeFile(
      evalFile,
      `
tests:
  - id: simple-case
    input: "Do something"
    criteria: "Should work"
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace).toBeUndefined();
  });

  describe('external workspace file reference', () => {
    it('should load workspace config from an external YAML file', async () => {
      const wsDir = path.join(testDir, 'shared');
      await mkdir(wsDir, { recursive: true });

      const workspaceFile = path.join(wsDir, 'workspace.yaml');
      await writeFile(
        workspaceFile,
        `
template: ./workspace-template
repos:
  - path: ./my-repo
    source:
      type: git
      url: https://github.com/org/repo.git
    checkout:
      ref: main
      resolve: remote
reset:
  strategy: hard
  after_each: true
`,
      );

      const evalFile = path.join(testDir, 'ext-workspace.yaml');
      await writeFile(
        evalFile,
        `
workspace: ./shared/workspace.yaml

tests:
  - id: ext-test-1
    input: "Do something"
    criteria: "Should work"
  - id: ext-test-2
    input: "Do something else"
    criteria: "Should also work"
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(2);

      // Both cases inherit the external workspace config
      for (const c of cases) {
        expect(c.workspace).toBeDefined();
        // template resolved relative to workspace file's directory
        expect(c.workspace?.template).toBe(path.join(wsDir, 'workspace-template'));
        expect(c.workspace?.repos).toHaveLength(1);
        expect(c.workspace?.repos?.[0].source).toEqual({
          type: 'git',
          url: 'https://github.com/org/repo.git',
        });
        expect(c.workspace?.repos?.[0].checkout?.ref).toBe('main');
        expect(c.workspace?.reset?.strategy).toBe('hard');
        expect(c.workspace?.reset?.after_each).toBe(true);
      }
    });

    it('should resolve paths in external workspace file relative to the workspace file directory', async () => {
      const wsDir = path.join(testDir, 'nested', 'config');
      await mkdir(wsDir, { recursive: true });

      const workspaceFile = path.join(wsDir, 'workspace.yaml');
      await writeFile(
        workspaceFile,
        `
template: ./my-template
before_all:
  command: ["node", "setup.mjs"]
  cwd: ./scripts
`,
      );

      const evalFile = path.join(testDir, 'nested-ext-workspace.yaml');
      await writeFile(
        evalFile,
        `
workspace: ./nested/config/workspace.yaml

tests:
  - id: path-test
    input: "Do something"
    criteria: "Should work"
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(1);
      // template resolved relative to workspace file dir (nested/config/)
      expect(cases[0].workspace?.template).toBe(path.join(wsDir, 'my-template'));
      // cwd resolved relative to workspace file dir
      expect(cases[0].workspace?.before_all?.cwd).toBe(path.join(wsDir, 'scripts'));
    });

    it('should throw a clear error when workspace file is not found', async () => {
      const evalFile = path.join(testDir, 'missing-workspace.yaml');
      await writeFile(
        evalFile,
        `
workspace: ./nonexistent/workspace.yaml

tests:
  - id: test-1
    input: "Do something"
    criteria: "Should work"
`,
      );

      await expect(loadTests(evalFile, testDir)).rejects.toThrow(
        /Workspace file not found.*nonexistent\/workspace\.yaml/,
      );
    });

    it('should allow per-case workspace override with external suite workspace', async () => {
      const wsDir = path.join(testDir, 'override-shared');
      await mkdir(wsDir, { recursive: true });

      const workspaceFile = path.join(wsDir, 'workspace.yaml');
      await writeFile(
        workspaceFile,
        `
template: ./base-template
before_all:
  command: ["node", "base-setup.mjs"]
reset:
  strategy: hard
  after_each: true
`,
      );

      const evalFile = path.join(testDir, 'override-ext-workspace.yaml');
      await writeFile(
        evalFile,
        `
workspace: ./override-shared/workspace.yaml

tests:
  - id: default-case
    input: "Do something"
    criteria: "Should work"
  - id: override-case
    input: "Do something else"
    criteria: "Should work"
    workspace:
      before_all:
        command: ["node", "custom-setup.mjs"]
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(2);

      // default-case inherits external workspace
      const defaultCase = cases.find((c) => c.id === 'default-case');
      expect(defaultCase?.workspace?.before_all?.command).toEqual(['node', 'base-setup.mjs']);
      expect(defaultCase?.workspace?.template).toBe(path.join(wsDir, 'base-template'));
      expect(defaultCase?.workspace?.reset?.strategy).toBe('hard');

      // override-case: before_all replaced, template and reset inherited
      const overrideCase = cases.find((c) => c.id === 'override-case');
      expect(overrideCase?.workspace?.before_all?.command).toEqual(['node', 'custom-setup.mjs']);
      expect(overrideCase?.workspace?.template).toBe(path.join(wsDir, 'base-template'));
      expect(overrideCase?.workspace?.reset?.strategy).toBe('hard');
    });
  });
});
