import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveEvalPaths } from '../../../src/commands/eval/shared.js';

describe('resolveEvalPaths', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-resolve-eval-paths-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns matches from any include glob instead of requiring all includes to match', async () => {
    const evalDir = path.join(tempDir, 'evals', 'suite-a');
    mkdirSync(evalDir, { recursive: true });

    const evalFile = path.join(evalDir, 'eval.yaml');
    writeFileSync(evalFile, 'tests:\n  - id: sample\n    input: test\n');

    const resolved = await resolveEvalPaths(
      ['evals/**/*.eval.yaml', 'evals/**/eval.yaml'],
      tempDir,
    );

    expect(resolved).toEqual([path.normalize(evalFile)]);
  });

  it('applies negation patterns to the combined match set', async () => {
    const includedDir = path.join(tempDir, 'evals', 'included');
    const excludedDir = path.join(tempDir, 'evals', 'excluded');
    mkdirSync(includedDir, { recursive: true });
    mkdirSync(excludedDir, { recursive: true });

    const includedFile = path.join(includedDir, 'eval.yaml');
    const excludedFile = path.join(excludedDir, 'eval.yaml');
    writeFileSync(includedFile, 'tests:\n  - id: included\n    input: test\n');
    writeFileSync(excludedFile, 'tests:\n  - id: excluded\n    input: test\n');

    const resolved = await resolveEvalPaths(['evals/**/eval.yaml', '!evals/excluded/**'], tempDir);

    expect(resolved).toEqual([path.normalize(includedFile)]);
  });

  it('applies negation patterns to direct file references', async () => {
    const evalDir = path.join(tempDir, 'evals', 'suite-a');
    mkdirSync(evalDir, { recursive: true });

    const evalFile = path.join(evalDir, 'eval.yaml');
    writeFileSync(evalFile, 'tests:\n  - id: sample\n    input: test\n');

    await expect(resolveEvalPaths([evalFile, '!evals/**'], tempDir)).rejects.toThrow(
      'No eval files matched any provided paths or globs',
    );
  });

  it('throws only when the combined include set is empty', async () => {
    await expect(
      resolveEvalPaths(['evals/**/*.eval.yaml', 'evals/**/eval.yaml'], tempDir),
    ).rejects.toThrow('No eval files matched any provided paths or globs');
  });

  it('rejects direct .json eval paths with conversion guidance', async () => {
    const evalFile = path.join(tempDir, 'evals.json');
    writeFileSync(evalFile, '{"skill_name":"demo","evals": []}');

    await expect(resolveEvalPaths([evalFile], tempDir)).rejects.toThrow('agentv convert');
  });

  it('accepts Agent Skills evals.json when read adapters are enabled', async () => {
    const evalFile = path.join(tempDir, 'evals.json');
    writeFileSync(
      evalFile,
      JSON.stringify({
        skill_name: 'demo',
        evals: [{ id: 1, prompt: 'Do the thing', expected_output: 'Thing done' }],
      }),
    );

    const resolved = await resolveEvalPaths([evalFile], tempDir, { allowReadAdapters: true });

    expect(resolved).toEqual([path.normalize(evalFile)]);
  });

  it('rejects evals.json without skill_name even when read adapters are enabled', async () => {
    const evalFile = path.join(tempDir, 'evals.json');
    writeFileSync(evalFile, '{"evals": []}');

    await expect(
      resolveEvalPaths([evalFile], tempDir, { allowReadAdapters: true }),
    ).rejects.toThrow("top-level 'skill_name' and 'evals'");
  });

  it('discovers *.eval.ts files from directory auto-expansion', async () => {
    const evalDir = path.join(tempDir, 'evals');
    mkdirSync(evalDir, { recursive: true });

    const tsFile = path.join(evalDir, 'greeting.eval.ts');
    writeFileSync(tsFile, 'export default { tests: [] }');

    const resolved = await resolveEvalPaths([tempDir], tempDir);

    expect(resolved).toEqual([path.normalize(tsFile)]);
  });

  it('does not discover agentvconfig.ts files from directory auto-expansion', async () => {
    const evalDir = path.join(tempDir, 'evals');
    mkdirSync(evalDir, { recursive: true });

    const tsFile = path.join(evalDir, 'agentvconfig.ts');
    const helperFile = path.join(evalDir, 'helper.ts');
    writeFileSync(tsFile, 'export default { tests: [] }');
    writeFileSync(helperFile, 'export const helper = true');

    await expect(resolveEvalPaths([tempDir], tempDir)).rejects.toThrow(
      'No eval files matched any provided paths or globs',
    );
  });

  it('does not discover promptfooconfig.ts files from directory auto-expansion', async () => {
    const evalDir = path.join(tempDir, 'evals');
    mkdirSync(evalDir, { recursive: true });

    const tsFile = path.join(evalDir, 'promptfooconfig.ts');
    writeFileSync(tsFile, 'export default { tests: [] }');

    await expect(resolveEvalPaths([tempDir], tempDir)).rejects.toThrow(
      'No eval files matched any provided paths or globs',
    );
  });

  it('discovers Agent Skills evals.json from directory auto-expansion when read adapters are enabled', async () => {
    const evalDir = path.join(tempDir, 'skills', 'demo', 'evals');
    mkdirSync(evalDir, { recursive: true });

    const evalFile = path.join(evalDir, 'evals.json');
    writeFileSync(
      evalFile,
      JSON.stringify({
        skill_name: 'demo',
        evals: [{ id: 1, prompt: 'Do the thing', expected_output: 'Thing done' }],
      }),
    );

    const resolved = await resolveEvalPaths([tempDir], tempDir, { allowReadAdapters: true });

    expect(resolved).toEqual([path.normalize(evalFile)]);
  });

  it('accepts a direct .mts file path', async () => {
    const tsFile = path.join(tempDir, 'custom.eval.mts');
    writeFileSync(tsFile, 'export default { tests: [] }');

    const resolved = await resolveEvalPaths([tsFile], tempDir);

    expect(resolved).toEqual([path.normalize(tsFile)]);
  });

  it('accepts a direct .ts file path', async () => {
    const tsFile = path.join(tempDir, 'custom.eval.ts');
    writeFileSync(tsFile, 'export default { tests: [] }');

    const resolved = await resolveEvalPaths([tsFile], tempDir);

    expect(resolved).toEqual([path.normalize(tsFile)]);
  });

  it('does not accept arbitrary direct .ts file paths as eval configs', async () => {
    const tsFile = path.join(tempDir, 'helper.ts');
    writeFileSync(tsFile, 'export const helper = true');

    await expect(resolveEvalPaths([tsFile], tempDir)).rejects.toThrow(
      'No eval files matched any provided paths or globs',
    );
  });

  it('filters arbitrary TypeScript files from broad globs', async () => {
    const evalDir = path.join(tempDir, 'evals');
    mkdirSync(evalDir, { recursive: true });

    const tsFile = path.join(evalDir, 'custom.eval.mts');
    const helperFile = path.join(evalDir, 'helper.ts');
    writeFileSync(tsFile, 'export default { tests: [] }');
    writeFileSync(helperFile, 'export const helper = true');

    const resolved = await resolveEvalPaths(['evals/**/*.ts', 'evals/**/*.mts'], tempDir);

    expect(resolved).toEqual([path.normalize(tsFile)]);
  });

  it('discovers both .yaml and .ts files from directory', async () => {
    const evalDir = path.join(tempDir, 'evals');
    mkdirSync(evalDir, { recursive: true });

    const yamlFile = path.join(evalDir, 'suite.eval.yaml');
    const suiteYamlFile = path.join(evalDir, 'suite.yaml');
    const evalYamlFile = path.join(evalDir, 'eval.yaml');
    const tsFile = path.join(evalDir, 'suite.eval.ts');
    writeFileSync(yamlFile, 'tests:\n  - id: sample\n    input: test\n');
    writeFileSync(suiteYamlFile, 'tests:\n  - id: sample-suite\n    input: test\n');
    writeFileSync(evalYamlFile, 'tests:\n  - id: sample2\n    input: test\n');
    writeFileSync(tsFile, 'export default { tests: [] }');

    const resolved = await resolveEvalPaths([tempDir], tempDir);

    expect(resolved).toContain(path.normalize(yamlFile));
    expect(resolved).toContain(path.normalize(suiteYamlFile));
    expect(resolved).toContain(path.normalize(evalYamlFile));
    expect(resolved).toContain(path.normalize(tsFile));
    expect(resolved).toHaveLength(4);
  });
});
