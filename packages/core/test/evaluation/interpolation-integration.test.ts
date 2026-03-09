import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTests } from '../../src/evaluation/yaml-parser.js';

describe('env interpolation in YAML loading', () => {
  let testDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `agentv-interp-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    savedEnv.AGENTV_TEST_CRITERIA = process.env.AGENTV_TEST_CRITERIA;
    savedEnv.AGENTV_TEST_PATH = process.env.AGENTV_TEST_PATH;
    process.env.AGENTV_TEST_CRITERIA = 'Must return correct answer';
    process.env.AGENTV_TEST_PATH = '/abs/path/to/repo';
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('interpolates ${{ VAR }} in test criteria field', async () => {
    const evalFile = path.join(testDir, 'interp-criteria.eval.yaml');
    await writeFile(
      evalFile,
      'tests:\n  - id: test-1\n    input: "hello"\n    criteria: "${{ AGENTV_TEST_CRITERIA }}"\n',
    );
    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].criteria).toBe('Must return correct answer');
  });

  it('interpolates ${{ VAR }} in workspace repo source path', async () => {
    const evalFile = path.join(testDir, 'interp-workspace.eval.yaml');
    await writeFile(
      evalFile,
      [
        'workspace:',
        '  repos:',
        '    - path: ./RepoA',
        '      source:',
        '        type: local',
        '        path: "${{ AGENTV_TEST_PATH }}"',
        'tests:',
        '  - id: test-1',
        '    input: "hello"',
        '    criteria: "do something"',
        '',
      ].join('\n'),
    );
    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].workspace?.repos?.[0]?.source).toEqual({
      type: 'local',
      path: '/abs/path/to/repo',
    });
  });

  it('interpolates ${{ VAR }} in external workspace YAML file', async () => {
    const workspaceFile = path.join(testDir, 'workspace.yaml');
    await writeFile(
      workspaceFile,
      [
        'repos:',
        '  - path: ./RepoB',
        '    source:',
        '      type: local',
        '      path: "${{ AGENTV_TEST_PATH }}"',
        '',
      ].join('\n'),
    );
    const evalFile = path.join(testDir, 'interp-ext-workspace.eval.yaml');
    await writeFile(
      evalFile,
      [
        'workspace: workspace.yaml',
        'tests:',
        '  - id: test-1',
        '    input: "hello"',
        '    criteria: "do something"',
        '',
      ].join('\n'),
    );
    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].workspace?.repos?.[0]?.source).toEqual({
      type: 'local',
      path: '/abs/path/to/repo',
    });
  });

  it('interpolates ${{ VAR }} in external YAML case files', async () => {
    const casesFile = path.join(testDir, 'cases.yaml');
    await writeFile(
      casesFile,
      ['- id: ext-1', '  input: "hello"', '  criteria: "${{ AGENTV_TEST_CRITERIA }}"', ''].join(
        '\n',
      ),
    );
    const evalFile = path.join(testDir, 'interp-external.eval.yaml');
    await writeFile(evalFile, 'tests: cases.yaml\n');
    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].criteria).toBe('Must return correct answer');
  });

  it('interpolates ${{ VAR }} in external JSONL case files', async () => {
    const casesFile = path.join(testDir, 'cases.jsonl');
    await writeFile(
      casesFile,
      '{"id": "ext-jsonl-1", "input": "hello", "criteria": "${{ AGENTV_TEST_CRITERIA }}"}\n',
    );
    const evalFile = path.join(testDir, 'interp-external-jsonl.eval.yaml');
    await writeFile(evalFile, 'tests: cases.jsonl\n');
    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].criteria).toBe('Must return correct answer');
  });

  it('leaves strings without ${{ }} unchanged', async () => {
    const evalFile = path.join(testDir, 'interp-none.eval.yaml');
    await writeFile(
      evalFile,
      'tests:\n  - id: test-1\n    input: "plain input"\n    criteria: "plain criteria"\n',
    );
    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].criteria).toBe('plain criteria');
  });

  it('resolves missing variables to empty string', async () => {
    const evalFile = path.join(testDir, 'interp-missing.eval.yaml');
    // Include expected_output so the test is not skipped for missing criteria
    // (empty criteria alone causes the test loader to skip it as incomplete)
    await writeFile(
      evalFile,
      'tests:\n  - id: test-1\n    input: "hello"\n    criteria: "prefix ${{ AGENTV_NONEXISTENT_VAR }} suffix"\n    expected_output: "some output"\n',
    );
    const cases = await loadTests(evalFile, testDir);
    expect(cases[0].criteria).toBe('prefix  suffix');
  });
});
