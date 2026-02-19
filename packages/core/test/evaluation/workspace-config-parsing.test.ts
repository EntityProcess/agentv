import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEvalCases } from '../../src/evaluation/yaml-parser.js';

describe('Workspace config parsing', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `agentv-ws-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should parse per-case workspace config with setup and teardown scripts', async () => {
    const evalFile = path.join(testDir, 'workspace-case.yaml');
    await writeFile(
      evalFile,
      `
cases:
  - id: test-case-1
    input: "Do something"
    criteria: "Should do the thing"
    workspace:
      setup_script:
        script: ["bun", "run", "setup.ts"]
        timeout_ms: 120000
      teardown_script:
        script: ["bun", "run", "teardown.ts"]
        timeout_ms: 30000
      env:
        CI: "1"
`,
    );

    const cases = await loadEvalCases(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace).toBeDefined();
    expect(cases[0].workspace!.setup_script).toEqual({
      script: ['bun', 'run', 'setup.ts'],
      timeout_ms: 120000,
    });
    expect(cases[0].workspace!.teardown_script).toEqual({
      script: ['bun', 'run', 'teardown.ts'],
      timeout_ms: 30000,
    });
    expect(cases[0].workspace!.env).toEqual({ CI: '1' });
  });

  it('should parse per-case metadata', async () => {
    const evalFile = path.join(testDir, 'metadata-case.yaml');
    await writeFile(
      evalFile,
      `
cases:
  - id: sympy-20590
    input: "Fix the bug"
    criteria: "Bug should be fixed"
    metadata:
      repo: sympy/sympy
      base_commit: "abc123def"
`,
    );

    const cases = await loadEvalCases(evalFile, testDir);
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
  setup_script:
    script: ["bun", "run", "default-setup.ts"]
  env:
    CI: "1"

cases:
  - id: case-1
    input: "Do something"
    criteria: "Should work"
  - id: case-2
    input: "Do something else"
    criteria: "Should also work"
`,
    );

    const cases = await loadEvalCases(evalFile, testDir);
    expect(cases).toHaveLength(2);
    // Both cases should inherit suite-level workspace
    expect(cases[0].workspace!.setup_script).toEqual({
      script: ['bun', 'run', 'default-setup.ts'],
    });
    expect(cases[0].workspace!.env).toEqual({ CI: '1' });
    expect(cases[1].workspace!.setup_script).toEqual({
      script: ['bun', 'run', 'default-setup.ts'],
    });
  });

  it('should merge case-level workspace with suite-level (case replaces scripts, env deep-merged)', async () => {
    const evalFile = path.join(testDir, 'workspace-merge.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  setup_script:
    script: ["bun", "run", "default-setup.ts"]
  env:
    CI: "1"
    NODE_ENV: production

cases:
  - id: case-override
    input: "Do something"
    criteria: "Should work"
    workspace:
      setup_script:
        script: ["bun", "run", "custom-setup.ts"]
      env:
        PYTHON_VERSION: "3.9"
  - id: case-default
    input: "Do something else"
    criteria: "Should work"
`,
    );

    const cases = await loadEvalCases(evalFile, testDir);
    expect(cases).toHaveLength(2);

    // case-override: setup_script replaced, env deep-merged
    const overrideCase = cases.find((c) => c.id === 'case-override')!;
    expect(overrideCase.workspace!.setup_script).toEqual({
      script: ['bun', 'run', 'custom-setup.ts'],
    });
    expect(overrideCase.workspace!.env).toEqual({
      CI: '1',
      NODE_ENV: 'production',
      PYTHON_VERSION: '3.9',
    });

    // case-default: inherits suite-level workspace entirely
    const defaultCase = cases.find((c) => c.id === 'case-default')!;
    expect(defaultCase.workspace!.setup_script).toEqual({
      script: ['bun', 'run', 'default-setup.ts'],
    });
  });

  it('should resolve setup_script cwd relative to eval file directory', async () => {
    const evalFile = path.join(testDir, 'workspace-cwd.yaml');
    await writeFile(
      evalFile,
      `
cases:
  - id: test-cwd
    input: "Do something"
    criteria: "Should work"
    workspace:
      setup_script:
        script: ["bun", "run", "setup.ts"]
        cwd: ./scripts
`,
    );

    const cases = await loadEvalCases(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace!.setup_script!.cwd).toBe(path.join(testDir, 'scripts'));
  });

  it('should parse workspace template path', async () => {
    const evalFile = path.join(testDir, 'workspace-template.yaml');
    await writeFile(
      evalFile,
      `
workspace:
  template: ./workspace-template

cases:
  - id: test-template
    input: "Do something"
    criteria: "Should work"
`,
    );

    const cases = await loadEvalCases(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace!.template).toBe(path.join(testDir, 'workspace-template'));
  });

  it('should handle case with no workspace config', async () => {
    const evalFile = path.join(testDir, 'no-workspace.yaml');
    await writeFile(
      evalFile,
      `
cases:
  - id: simple-case
    input: "Do something"
    criteria: "Should work"
`,
    );

    const cases = await loadEvalCases(evalFile, testDir);
    expect(cases).toHaveLength(1);
    expect(cases[0].workspace).toBeUndefined();
  });
});
