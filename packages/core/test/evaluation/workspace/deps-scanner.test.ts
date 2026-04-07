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

  it('extracts git repos from suite-level workspace', async () => {
    const file = await writeYaml(
      'suite-level.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo-a
      source:
        type: git
        url: https://github.com/org/repo-a.git
      checkout:
        ref: main
      clone:
        depth: 1
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
      clone: { depth: 1 },
    });
    expect(result.repos[0].usedBy).toEqual([file]);
  });

  it('extracts git repos from per-test workspace', async () => {
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
          source:
            type: git
            url: https://github.com/org/repo-b.git
          checkout:
            ref: v2.0
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

  it('deduplicates repos by (url, ref)', async () => {
    const file1 = await writeYaml(
      'dedup-1.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/shared.git
      checkout:
        ref: main
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );
    const file2 = await writeYaml(
      'dedup-2.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/shared.git
      checkout:
        ref: main
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file1, file2]);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].usedBy).toEqual([file1, file2]);
  });

  it('treats different refs as different deps', async () => {
    const file = await writeYaml(
      'diff-refs.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo-main
      source:
        type: git
        url: https://github.com/org/repo.git
      checkout:
        ref: main
    - path: ./repo-dev
      source:
        type: git
        url: https://github.com/org/repo.git
      checkout:
        ref: develop
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

  it('skips local source repos', async () => {
    const file = await writeYaml(
      'local-source.eval.yaml',
      `
workspace:
  repos:
    - path: ./local-repo
      source:
        type: local
        path: /tmp/some-repo
    - path: ./git-repo
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
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].url).toBe('https://github.com/org/repo.git');
  });

  it('resolves external workspace file references', async () => {
    const wsFile = await writeYaml(
      'shared/workspace.yaml',
      `
repos:
  - path: ./external-repo
    source:
      type: git
      url: https://github.com/org/external.git
    checkout:
      ref: v1.0
    clone:
      depth: 2
      filter: blob:none
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
      clone: { depth: 2, filter: 'blob:none' },
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
      source:
        type: git
        url: https://github.com/org/good.git
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

  it('handles repos with no ref (defaults to undefined)', async () => {
    const file = await writeYaml(
      'no-ref.eval.yaml',
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
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].ref).toBeUndefined();
  });

  it('includes clone sparse config', async () => {
    const file = await writeYaml(
      'sparse.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git
      clone:
        sparse:
          - src/**
          - tests/**
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos[0].clone).toEqual({ sparse: ['src/**', 'tests/**'] });
  });

  it('includes checkout resolve and ancestor', async () => {
    const file = await writeYaml(
      'checkout-opts.eval.yaml',
      `
workspace:
  repos:
    - path: ./repo
      source:
        type: git
        url: https://github.com/org/repo.git
      checkout:
        ref: main
        resolve: remote
        ancestor: 3
tests:
  - id: test-1
    input: hello
    criteria: world
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos[0]).toMatchObject({
      ref: 'main',
      checkout: { resolve: 'remote', ancestor: 3 },
    });
  });

  it('collects repos from both suite-level and per-test workspaces', async () => {
    const file = await writeYaml(
      'both-levels.eval.yaml',
      `
workspace:
  repos:
    - path: ./suite-repo
      source:
        type: git
        url: https://github.com/org/suite.git
      checkout:
        ref: main
tests:
  - id: test-1
    input: hello
    criteria: world
    workspace:
      repos:
        - path: ./test-repo
          source:
            type: git
            url: https://github.com/org/test-only.git
          checkout:
            ref: v1
`,
    );

    const result = await scanRepoDeps([file]);
    expect(result.repos).toHaveLength(2);
    const urls = result.repos.map((r) => r.url);
    expect(urls).toContain('https://github.com/org/suite.git');
    expect(urls).toContain('https://github.com/org/test-only.git');
  });
});
