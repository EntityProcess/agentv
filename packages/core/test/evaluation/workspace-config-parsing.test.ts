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

  it('should parse per-case workspace config with before_all and after_each hooks', async () => {
    const evalFile = path.join(testDir, 'workspace-case.yaml');
    await writeFile(
      evalFile,
      `prompts:
  - "{{ input }}"
tests:
  - id: test-case-1
    criteria: Should do the thing
    workspace:
      hooks:
        before_all:
          command:
            - bun
            - run
            - setup.ts
          timeout_ms: 120000
        after_each:
          command:
            - bun
            - run
            - teardown.ts
          timeout_ms: 30000
    vars:
      input: Do something
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace).toBeDefined();
    expect(cases[0].workspace?.hooks?.before_all).toEqual({
      command: ['bun', 'run', 'setup.ts'],
      timeout_ms: 120000,
    });
    expect(cases[0].workspace?.hooks?.after_each).toEqual({
      command: ['bun', 'run', 'teardown.ts'],
      timeout_ms: 30000,
    });
  });

  it('should parse per-case metadata', async () => {
    const evalFile = path.join(testDir, 'metadata-case.yaml');
    await writeFile(
      evalFile,
      `prompts:
  - "{{ input }}"
tests:
  - id: sympy-20590
    criteria: Bug should be fixed
    metadata:
      repo: sympy/sympy
      source_commit: abc123def
    vars:
      input: Fix the bug
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].metadata).toEqual({
      repo: 'sympy/sympy',
      source_commit: 'abc123def',
    });
  });

  it('should parse suite-level workspace config as default', async () => {
    const evalFile = path.join(testDir, 'workspace-suite.yaml');
    await writeFile(
      evalFile,
      `workspace:
  hooks:
    before_all:
      command:
        - bun
        - run
        - default-setup.ts
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should work
    vars:
      input: Do something
  - id: case-2
    criteria: Should also work
    vars:
      input: Do something else
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(2);
    // Both cases should inherit suite-level workspace
    expect(cases[0].workspace?.hooks?.before_all).toEqual({
      command: ['bun', 'run', 'default-setup.ts'],
    });
    expect(cases[1].workspace?.hooks?.before_all).toEqual({
      command: ['bun', 'run', 'default-setup.ts'],
    });
  });

  it('should merge case-level workspace with suite-level (case replaces scripts)', async () => {
    const evalFile = path.join(testDir, 'workspace-merge.yaml');
    await writeFile(
      evalFile,
      `workspace:
  hooks:
    before_all:
      command:
        - bun
        - run
        - default-setup.ts
prompts:
  - "{{ input }}"
tests:
  - id: case-override
    criteria: Should work
    workspace:
      hooks:
        before_all:
          command:
            - bun
            - run
            - custom-setup.ts
    vars:
      input: Do something
  - id: case-default
    criteria: Should work
    vars:
      input: Do something else
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(2);

    // case-override: before_all replaced
    const overrideCase = cases.find((c) => c.id === 'case-override');
    expect(overrideCase).toBeDefined();
    expect(overrideCase.workspace?.hooks?.before_all).toEqual({
      command: ['bun', 'run', 'custom-setup.ts'],
    });

    // case-default: inherits suite-level workspace entirely
    const defaultCase = cases.find((c) => c.id === 'case-default');
    expect(defaultCase).toBeDefined();
    expect(defaultCase.workspace?.hooks?.before_all).toEqual({
      command: ['bun', 'run', 'default-setup.ts'],
    });
  });

  it('should preserve workspace env when merging case-level workspace with suite defaults', async () => {
    const evalFile = path.join(testDir, 'workspace-env-merge.yaml');
    await writeFile(
      evalFile,
      `workspace:
  hooks:
    before_all:
      command:
        - bun
        - run
        - default-setup.ts
prompts:
  - "{{ input }}"
tests:
  - id: case-env
    criteria: Should work
    workspace:
      env:
        required_commands:
          - git
        required_python_modules:
          - json
    vars:
      input: Do something
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace?.hooks?.before_all).toEqual({
      command: ['bun', 'run', 'default-setup.ts'],
    });
    expect(cases[0].workspace?.env).toEqual({
      required_commands: ['git'],
      required_python_modules: ['json'],
    });
  });

  it('should resolve before_all cwd relative to eval file directory', async () => {
    const evalFile = path.join(testDir, 'workspace-cwd.yaml');
    await writeFile(
      evalFile,
      `prompts:
  - "{{ input }}"
tests:
  - id: test-cwd
    criteria: Should work
    workspace:
      hooks:
        before_all:
          command:
            - bun
            - run
            - setup.ts
          cwd: ./scripts
    vars:
      input: Do something
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace?.hooks?.before_all?.cwd).toBe(path.join(testDir, 'scripts'));
  });

  it('rejects public workspace template authoring', async () => {
    const evalFile = path.join(testDir, 'workspace-template.yaml');
    await writeFile(
      evalFile,
      `workspace:
  template: ./workspace-template
prompts:
  - "{{ input }}"
tests:
  - id: test-template
    criteria: Should work
    vars:
      input: Do something
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(
      /workspace\.template has been removed from public eval YAML/,
    );
  });

  it('parses Docker environment setup argv without repo identity', async () => {
    const evalFile = path.join(testDir, 'environment-docker-no-source.yaml');
    await writeFile(
      evalFile,
      `prompts:
  - "{{ input }}"
tests:
  - id: docker-no-source
    criteria: Should work
    environment:
      type: docker
      image: swebench/sweb.eval.django__django:latest
      workdir: /testbed
      setup:
        command: ["bash", "./setup.sh", "abc123def"]
        cwd: "."
        timeout_ms: 120000
    vars:
      input: Do something
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].environment).toMatchObject({
      type: 'docker',
      image: 'swebench/sweb.eval.django__django:latest',
      workdir: '/testbed',
      setup: {
        command: ['bash', './setup.sh', 'abc123def'],
        cwd: '.',
        timeoutMs: 120000,
      },
    });
  });

  it('rejects Docker environment setup args', async () => {
    const evalFile = path.join(testDir, 'environment-path-checkout-only.yaml');
    await writeFile(
      evalFile,
      `prompts:
  - "{{ input }}"
tests:
  - id: path-checkout-only
    criteria: Should work
    environment:
      type: docker
      image: myimage:latest
      workdir: /workspace/project
      setup:
        command: ["bash", "./setup.sh"]
        args:
          commit: v2.0.0
    vars:
      input: Do something
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(
      'environment.setup.args is not supported',
    );
  });

  it('rejects public workspace repos authoring', async () => {
    const evalFile = path.join(testDir, 'workspace-repos.yaml');
    await writeFile(
      evalFile,
      `description: test
workspace:
  repos:
    - path: ./repo-a
      repo: https://github.com/org/repo.git
      commit: main
      ancestor: 1
      sparse:
        - src/**
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: world
    vars:
      input: hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(
      /workspace\.repos has been removed from public eval YAML/,
    );
  });

  it('rejects removed workspace repo resolver field', async () => {
    const evalFile = path.join(testDir, 'workspace-repos-resolver.yaml');
    await writeFile(
      evalFile,
      `description: test
workspace:
  repos:
    - path: ./repo-a
      repo: https://github.com/org/repo.git
      resolver: custom
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: world
    vars:
      input: hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(
      /workspace\.repos has been removed from public eval YAML/,
    );
  });

  it('parses legacy internal workspace hooks after_each reset config', async () => {
    const evalFile = path.join(testDir, 'workspace-reset.yaml');
    await writeFile(
      evalFile,
      `description: test
workspace:
  hooks:
    after_each:
      reset: fast
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: world
    vars:
      input: hello
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].workspace?.hooks?.after_each?.reset).toBe('fast');
  });

  it('rejects public workspace scope authoring', async () => {
    const evalFile = path.join(testDir, 'workspace-scope.yaml');
    await writeFile(
      evalFile,
      `description: test
workspace:
  scope: attempt
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: world
    vars:
      input: hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(
      /workspace\.scope has been removed from public eval YAML/,
    );
  });

  it('rejects removed workspace isolation field', async () => {
    const evalFile = path.join(testDir, 'workspace-isolation-legacy.yaml');
    await writeFile(
      evalFile,
      `description: test
workspace:
  isolation: per_test
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: world
    vars:
      input: hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(
      'workspace.isolation has been removed. Use environment at suite/test scope and let AgentV manage runtime isolation.',
    );
  });

  it('rejects removed workspace.path', async () => {
    const evalFile = path.join(testDir, 'workspace-path-removed.yaml');
    await writeFile(
      evalFile,
      `workspace:
  path: /tmp/shared-workspace
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should parse
    vars:
      input: Hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(/workspace\.path has been removed/i);
  });

  it('rejects removed workspace.mode', async () => {
    const evalFile = path.join(testDir, 'workspace-mode-removed.yaml');
    await writeFile(
      evalFile,
      `workspace:
  mode: temp
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should parse
    vars:
      input: Hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(/workspace\.mode has been removed/i);
  });

  it('rejects removed workspace.static_path field', async () => {
    const evalFile = path.join(testDir, 'workspace-static-path-removed.yaml');
    await writeFile(
      evalFile,
      `workspace:
  mode: static
  static_path: /tmp/shared-workspace
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should parse
    vars:
      input: Hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(
      /workspace\.static_path has been removed/i,
    );
  });

  it('rejects removed workspace.pool field', async () => {
    const evalFile = path.join(testDir, 'workspace-pool-removed.yaml');
    await writeFile(
      evalFile,
      `workspace:
  pool: true
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should parse
    vars:
      input: Hello
`,
    );

    await expect(loadTests(evalFile, testDir)).rejects.toThrow(/workspace\.pool has been removed/i);
  });

  it('should accept string command and auto-split on whitespace', async () => {
    const evalFile = path.join(testDir, 'workspace-string-cmd.yaml');
    await writeFile(
      evalFile,
      `prompts:
  - "{{ input }}"
tests:
  - id: test-string-cmd
    criteria: Should work
    workspace:
      hooks:
        before_all:
          command: node scripts/setup.mjs
          timeout_ms: 60000
    vars:
      input: Do something
`,
    );

    const cases = await loadTests(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace?.hooks?.before_all).toEqual({
      command: ['node', 'scripts/setup.mjs'],
      timeout_ms: 60000,
    });
  });

  it('should handle case with no workspace config', async () => {
    const evalFile = path.join(testDir, 'no-workspace.yaml');
    await writeFile(
      evalFile,
      `prompts:
  - "{{ input }}"
tests:
  - id: simple-case
    criteria: Should work
    vars:
      input: Do something
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
hooks:
  after_each:
    reset: fast
`,
      );

      const evalFile = path.join(testDir, 'ext-workspace.yaml');
      await writeFile(
        evalFile,
        `workspace: ./shared/workspace.yaml
prompts:
  - "{{ input }}"
tests:
  - id: ext-test-1
    criteria: Should work
    vars:
      input: Do something
  - id: ext-test-2
    criteria: Should also work
    vars:
      input: Do something else
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(2);

      // Both cases inherit the external workspace config
      for (const c of cases) {
        expect(c.workspace).toBeDefined();
        expect(c.workspace?.hooks?.after_each?.reset).toBe('fast');
      }
    });

    it('should resolve paths in external workspace file relative to the workspace file directory', async () => {
      const wsDir = path.join(testDir, 'nested', 'config');
      await mkdir(wsDir, { recursive: true });

      const workspaceFile = path.join(wsDir, 'workspace.yaml');
      await writeFile(
        workspaceFile,
        `
hooks:
  before_all:
    command: ["node", "setup.mjs"]
    cwd: ./scripts
`,
      );

      const evalFile = path.join(testDir, 'nested-ext-workspace.yaml');
      await writeFile(
        evalFile,
        `workspace: ./nested/config/workspace.yaml
prompts:
  - "{{ input }}"
tests:
  - id: path-test
    criteria: Should work
    vars:
      input: Do something
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(1);
      // cwd resolved relative to workspace file dir
      expect(cases[0].workspace?.hooks?.before_all?.cwd).toBe(path.join(wsDir, 'scripts'));
      // workspaceFileDir is set to the workspace file's directory
      expect(cases[0].workspace?.workspaceFileDir).toBe(wsDir);
    });

    it('should set workspaceFileDir when workspace is a file reference', async () => {
      const wsDir = path.join(testDir, 'wsfiledir-test');
      await mkdir(wsDir, { recursive: true });

      const workspaceFile = path.join(wsDir, 'workspace.yaml');
      await writeFile(
        workspaceFile,
        `
hooks:
  before_all:
    command: ["echo", "hello"]
`,
      );

      const evalFile = path.join(testDir, 'wsfiledir-eval.yaml');
      await writeFile(
        evalFile,
        `workspace: ./wsfiledir-test/workspace.yaml
prompts:
  - "{{ input }}"
tests:
  - id: wsfiledir-test-1
    criteria: Should work
    vars:
      input: Do something
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(1);
      expect(cases[0].workspace?.workspaceFileDir).toBe(wsDir);
    });

    it('should not set workspaceFileDir for inline workspace config', async () => {
      const evalFile = path.join(testDir, 'inline-workspace.yaml');
      await writeFile(
        evalFile,
        `workspace:
  hooks:
    before_all:
      command:
        - echo
        - hello
prompts:
  - "{{ input }}"
tests:
  - id: inline-test-1
    criteria: Should work
    vars:
      input: Do something
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(1);
      expect(cases[0].workspace?.workspaceFileDir).toBeUndefined();
    });

    it('should throw a clear error when workspace file is not found', async () => {
      const evalFile = path.join(testDir, 'missing-workspace.yaml');
      await writeFile(
        evalFile,
        `workspace: ./nonexistent/workspace.yaml
prompts:
  - "{{ input }}"
tests:
  - id: test-1
    criteria: Should work
    vars:
      input: Do something
`,
      );

      await expect(loadTests(evalFile, testDir)).rejects.toThrow(
        /Workspace file not found.*nonexistent\/workspace\.yaml/,
      );
    });

    it('should throw a clear error when legacy external workspace file wraps config under workspace', async () => {
      const wsDir = path.join(testDir, 'wrapped-workspace');
      await mkdir(wsDir, { recursive: true });

      const workspaceFile = path.join(wsDir, 'workspace.yaml');
      await writeFile(
        workspaceFile,
        `
workspace:
  hooks:
    after_each:
      reset: fast
`,
      );

      const evalFile = path.join(testDir, 'wrapped-workspace-eval.yaml');
      await writeFile(
        evalFile,
        `workspace: ./wrapped-workspace/workspace.yaml
prompts:
  - "{{ input }}"
tests:
  - id: wrapped-workspace
    criteria: Should work
    vars:
      input: Do something
`,
      );

      await expect(loadTests(evalFile, testDir)).rejects.toThrow(
        /External workspace files must contain the workspace config object directly.*Remove the top-level "workspace:" wrapper/,
      );
    });

    it('should allow per-case workspace override with external suite workspace', async () => {
      const wsDir = path.join(testDir, 'override-shared');
      await mkdir(wsDir, { recursive: true });

      const workspaceFile = path.join(wsDir, 'workspace.yaml');
      await writeFile(
        workspaceFile,
        `
hooks:
  before_all:
    command: ["node", "base-setup.mjs"]
  after_each:
    reset: fast
`,
      );

      const evalFile = path.join(testDir, 'override-ext-workspace.yaml');
      await writeFile(
        evalFile,
        `workspace: ./override-shared/workspace.yaml
prompts:
  - "{{ input }}"
tests:
  - id: default-case
    criteria: Should work
    vars:
      input: Do something
  - id: override-case
    criteria: Should work
    workspace:
      hooks:
        before_all:
          command:
            - node
            - custom-setup.mjs
    vars:
      input: Do something else
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(2);

      // default-case inherits external workspace
      const defaultCase = cases.find((c) => c.id === 'default-case');
      expect(defaultCase?.workspace?.hooks?.before_all?.command).toEqual([
        'node',
        'base-setup.mjs',
      ]);
      expect(defaultCase?.workspace?.hooks?.after_each?.reset).toBe('fast');

      // override-case: before_all replaced, after_each inherited
      const overrideCase = cases.find((c) => c.id === 'override-case');
      expect(overrideCase?.workspace?.hooks?.before_all?.command).toEqual([
        'node',
        'custom-setup.mjs',
      ]);
      expect(overrideCase?.workspace?.hooks?.after_each?.reset).toBe('fast');
    });
  });

  describe('hooks.enabled', () => {
    it('parses hooks.enabled: false', async () => {
      const evalFile = path.join(testDir, 'hooks-disabled.yaml');
      await writeFile(
        evalFile,
        `workspace:
  hooks:
    enabled: false
    before_all:
      command:
        - bun
        - run
        - setup.ts
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should parse
    vars:
      input: Hello
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(1);
      expect(cases[0].workspace?.hooks?.enabled).toBe(false);
      expect(cases[0].workspace?.hooks?.before_all?.command).toEqual(['bun', 'run', 'setup.ts']);
    });

    it('parses hooks.enabled: true', async () => {
      const evalFile = path.join(testDir, 'hooks-enabled.yaml');
      await writeFile(
        evalFile,
        `workspace:
  hooks:
    enabled: true
    before_all:
      command:
        - bun
        - run
        - setup.ts
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should parse
    vars:
      input: Hello
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(1);
      expect(cases[0].workspace?.hooks?.enabled).toBe(true);
    });

    it('defaults hooks.enabled to undefined when omitted', async () => {
      const evalFile = path.join(testDir, 'hooks-default.yaml');
      await writeFile(
        evalFile,
        `workspace:
  hooks:
    before_all:
      command:
        - bun
        - run
        - setup.ts
prompts:
  - "{{ input }}"
tests:
  - id: case-1
    criteria: Should parse
    vars:
      input: Hello
`,
      );

      const cases = await loadTests(evalFile, testDir);
      expect(cases).toHaveLength(1);
      expect(cases[0].workspace?.hooks?.enabled).toBeUndefined();
    });
  });
});
