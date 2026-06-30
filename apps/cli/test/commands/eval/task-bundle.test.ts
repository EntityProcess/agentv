import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type EvalTest, parseYamlValue } from '@agentv/core';

import { materializeTaskBundle } from '../../../src/commands/eval/task-bundle.js';

describe('materializeTaskBundle', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-task-bundle-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes a self-contained test bundle without executing a provider', async () => {
    const evalFile = path.join(tempDir, 'evals', 'demo.eval.yaml');
    const fixturePath = path.join(tempDir, 'fixtures', 'input.txt');
    const promptPath = path.join(tempDir, 'graders', 'prompt.md');
    const scriptPath = path.join(tempDir, 'graders', 'check.ts');
    await mkdir(path.dirname(evalFile), { recursive: true });
    await mkdir(path.dirname(fixturePath), { recursive: true });
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(
      evalFile,
      'tests:\n  - id: direct-case\n    input: file://fixtures/input.txt\n',
    );
    await writeFile(fixturePath, 'fixture text\n');
    await writeFile(promptPath, 'grade carefully\n');
    await writeFile(scriptPath, 'console.log("ok");\n');

    const test = {
      id: 'direct-case',
      question: 'file://fixtures/input.txt',
      input: [],
      expected_output: [],
      file_paths: [fixturePath],
      criteria: 'quality',
      source: {
        evalFilePath: evalFile,
        evalFileAbsolutePath: evalFile,
        evalFileRepoPath: 'evals/demo.eval.yaml',
        testId: 'direct-case',
        testSnapshotYaml: 'id: direct-case\ninput: file://fixtures/input.txt',
        graderDefinitions: [
          {
            name: 'quality',
            type: 'llm-grader',
            definition: {
              name: 'quality',
              type: 'llm-grader',
              prompt: 'file://graders/prompt.md',
              command: ['bun', scriptPath, '--token', 'literal-secret'],
            },
          },
        ],
        references: [
          {
            kind: 'input_file',
            displayPath: 'fixtures/input.txt',
            resolvedPath: fixturePath,
          },
          {
            kind: 'llm_grader_prompt',
            displayPath: 'graders/prompt.md',
            resolvedPath: promptPath,
            graderName: 'quality',
          },
          {
            kind: 'code_grader_command',
            displayPath: scriptPath,
            resolvedPath: scriptPath,
            graderName: 'quality',
            command: ['bun', scriptPath],
          },
        ],
      },
    } satisfies EvalTest;

    const paths = await materializeTaskBundle({
      test,
      targetName: 'selected',
      targetDefinitions: [
        {
          name: 'selected',
          provider: 'mock',
          api_key: '${{ MOCK_API_KEY }}',
          fallback_targets: ['backup'],
        },
        {
          name: 'backup',
          provider: 'mock',
          api_key: 'literal-secret',
        },
      ],
      outputDir: path.join(tempDir, 'out'),
      cwd: tempDir,
      repoRoot: tempDir,
    });

    expect(paths).toBeDefined();
    const testBundleDir = paths?.testDir ?? '';
    expect(path.basename(testBundleDir)).toBe('test');
    expect(await readdir(testBundleDir)).toContain('EVAL.yaml');
    expect(await readFile(path.join(testBundleDir, 'files', 'fixtures', 'input.txt'), 'utf8')).toBe(
      'fixture text\n',
    );
    expect(
      await readFile(path.join(testBundleDir, 'graders', 'graders', 'prompt.md'), 'utf8'),
    ).toBe('grade carefully\n');
    expect(await readFile(path.join(testBundleDir, 'graders', 'graders', 'check.ts'), 'utf8')).toBe(
      'console.log("ok");\n',
    );

    const taskEval = await readFile(paths?.evalPath ?? '', 'utf8');
    const taskTargets = await readFile(paths?.targetsPath ?? '', 'utf8');
    const parsedEval = parseYamlValue(taskEval) as Record<string, unknown>;
    const [testCase] = parsedEval.tests as Record<string, unknown>[];
    const [assertion] = testCase.assertions as Record<string, unknown>[];

    expect(parsedEval.execution).toEqual({ target: 'selected' });
    expect(parsedEval.tests as unknown[]).toHaveLength(1);
    expect(testCase.id).toBe('direct-case');
    expect(testCase.input).toBe('file://files/fixtures/input.txt');
    expect(assertion.prompt).toBe('file://graders/graders/prompt.md');
    expect(assertion.command).toEqual(['bun', 'graders/graders/check.ts', '--token', '[redacted]']);
    expect(taskTargets).toContain('api_key: ${{ MOCK_API_KEY }}');
    expect(taskTargets).toContain('api_key: "[redacted]"');
    expect(taskEval).not.toContain('literal-secret');
    expect(taskTargets).not.toContain('literal-secret');
    await expect(readdir(path.join(tempDir, 'out', '.agentv', 'results'))).rejects.toThrow();
    await expect(readdir(path.join(testBundleDir, '.agentv', 'results'))).rejects.toThrow();
  });
});
