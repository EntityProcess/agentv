import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scanRepoDeps } from '../../../src/evaluation/workspace/deps-scanner.js';

describe('scanRepoDeps', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'deps-scanner-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeYaml(name: string, content: string): Promise<string> {
    const filePath = path.join(tempDir, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return filePath;
  }

  it('extracts repos from suite-level workspace', async () => {
    const file = await writeYaml(
      'suite-level.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo-a
      repo: https://github.com/org/repo-a.git
      commit: main
      sparse:
        - src
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.errors).toHaveLength(0);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      url: 'https://github.com/org/repo-a.git',
      ref: 'main',
      sparse: ['src'],
    });
    expect(result.repos[0].usedBy).toEqual([file]);
  });

  it('extracts repos from per-test workspace', async () => {
    const file = await writeYaml(
      'per-test.eval.yaml',
      `
tests:
  - id: test-1
    input: hello
    criteria: world
    workspace:
      repos:
        - path: ./repo-b
          repo: https://github.com/org/repo-b.git
          commit: v2.0
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.errors).toHaveLength(0);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      url: 'https://github.com/org/repo-b.git',
      ref: 'v2.0',
    });
  });

  it('resolves GitHub org/name shorthand to a URL', async () => {
    const file = await writeYaml(
      'shorthand.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      repo: org/repo
      commit: main
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.errors).toHaveLength(0);
    expect(result.repos[0]).toMatchObject({
      url: 'https://github.com/org/repo.git',
      ref: 'main',
    });
  });

  it('uses base_commit as a commit alias', async () => {
    const file = await writeYaml(
      'base-commit.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      repo: https://github.com/org/repo.git
      base_commit: abc123
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.errors).toHaveLength(0);
    expect(result.repos[0].ref).toBe('abc123');
  });

  it('deduplicates repos by canonical identity and ref', async () => {
    const file = await writeYaml(
      'dedup.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo-a
      repo: https://GitHub.com/Org/Shared.git
      commit: main
    - path: ./repo-b
      repo: org/shared
      commit: main
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.errors).toHaveLength(0);
    expect(result.repos).toHaveLength(1);
  });

  it('treats different refs as different deps', async () => {
    const file = await writeYaml(
      'diff-refs.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo-main
      repo: https://github.com/org/repo.git
      commit: main
    - path: ./repo-dev
      repo: https://github.com/org/repo.git
      commit: develop
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos).toHaveLength(2);
    const urls = result.repos.map((r) => `${r.url}@${r.ref}`);
    expect(urls).toContain('https://github.com/org/repo.git@main');
    expect(urls).toContain('https://github.com/org/repo.git@develop');
  });

  it('resolves external workspace file references', async () => {
    await writeYaml(
      'shared/workspace.yaml',
      `
repos:
  - path: ./external-repo
    repo: https://github.com/org/external.git
    commit: v1.0
    ancestor: 2
`,
    );

    const evalFile = await writeYaml(
      'external-ref.eval.yaml',
      `
workspace: ./shared/workspace.yaml
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([evalFile]);
    expect(result.errors).toHaveLength(0);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      url: 'https://github.com/org/external.git',
      ref: 'v1.0',
      ancestor: 2,
    });
  });

  it('returns empty repos for eval with no workspace', async () => {
    const file = await writeYaml(
      'no-workspace.eval.yaml',
      `
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('collects parse errors without stopping', async () => {
    const goodFile = await writeYaml(
      'good.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      repo: https://github.com/org/good.git
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );
    const badFile = path.join(tempDir, 'nonexistent.eval.yaml');

    const result = await scanRepoDeps([goodFile, badFile]);
    expect(result.repos).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe(badFile);
  });

  it('handles repos with no ref', async () => {
    const file = await writeYaml(
      'no-ref.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      repo: https://github.com/org/repo.git
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].ref).toBeUndefined();
  });

  it('interpolates env vars in repo URLs', async () => {
    const originalEnv = process.env.TEST_REPO_URL;
    process.env.TEST_REPO_URL = 'https://github.com/org/from-env.git';
    try {
      const file = await writeYaml(
        'env-var.eval.yaml',
        `
workspace:
  repos:
    - path: ./repo
      repo: \${{ TEST_REPO_URL }}
tests:
  - id: test-1
    input: hello
    criteria: world
`,
      );

      const result = await scanRepoDeps([file]);
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].url).toBe('https://github.com/org/from-env.git');
    } finally {
      process.env.TEST_REPO_URL = originalEnv;
    }
  });

  it('collects malformed YAML as error without crashing', async () => {
    const file = await writeYaml('bad-yaml.eval.yaml', ':\n  bad: yaml: [unclosed');

    const result = await scanRepoDeps([file]);
    expect(result.repos).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe(file);
  });

  it('collects error for broken external workspace file reference', async () => {
    const file = await writeYaml(
      'broken-ref.eval.yaml',
      `
workspace: ./nonexistent-workspace.yaml
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe(file);
  });

  it('reports legacy source schema as an error', async () => {
    const file = await writeYaml(
      'legacy-source.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos).toHaveLength(0);
    expect(result.errors[0].message).toContain('workspace.repos[].source has been removed');
  });
});
