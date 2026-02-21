import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  expandFileReferences,
  isFileReference,
  resolveFileReference,
} from '../../../src/evaluation/loaders/case-file-loader.js';
import { loadTestSuite, loadTests } from '../../../src/evaluation/yaml-parser.js';

describe('isFileReference', () => {
  it('returns true for file:// strings', () => {
    expect(isFileReference('file://cases/test.yaml')).toBe(true);
    expect(isFileReference('file://test.jsonl')).toBe(true);
    expect(isFileReference('file://path/**/*.yaml')).toBe(true);
  });

  it('returns false for non-file:// values', () => {
    expect(isFileReference('hello')).toBe(false);
    expect(isFileReference('')).toBe(false);
    expect(isFileReference(42)).toBe(false);
    expect(isFileReference(null)).toBe(false);
    expect(isFileReference({ id: 'test' })).toBe(false);
  });
});

describe('resolveFileReference', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-case-file-loader-${Date.now()}`);
    await mkdir(path.join(tempDir, 'cases'), { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads test objects from a YAML file', async () => {
    await writeFile(
      path.join(tempDir, 'cases', 'tests.yaml'),
      `- id: yaml-test-1
  criteria: "Test goal 1"
  input: "Hello"
- id: yaml-test-2
  criteria: "Test goal 2"
  input: "World"
`,
    );

    const cases = await resolveFileReference('file://cases/tests.yaml', tempDir);

    expect(cases).toHaveLength(2);
    expect(cases[0].id).toBe('yaml-test-1');
    expect(cases[0].criteria).toBe('Test goal 1');
    expect(cases[1].id).toBe('yaml-test-2');
    expect(cases[1].criteria).toBe('Test goal 2');
  });

  it('loads test objects from a JSONL file', async () => {
    await writeFile(
      path.join(tempDir, 'cases', 'tests.jsonl'),
      [
        '{"id": "jsonl-1", "criteria": "Goal 1", "input": "Query 1"}',
        '{"id": "jsonl-2", "criteria": "Goal 2", "input": "Query 2"}',
      ].join('\n'),
    );

    const cases = await resolveFileReference('file://cases/tests.jsonl', tempDir);

    expect(cases).toHaveLength(2);
    expect(cases[0].id).toBe('jsonl-1');
    expect(cases[1].id).toBe('jsonl-2');
  });

  it('resolves glob patterns to multiple files', async () => {
    await mkdir(path.join(tempDir, 'glob-cases'), { recursive: true });
    await writeFile(
      path.join(tempDir, 'glob-cases', 'a.yaml'),
      '- id: glob-a\n  criteria: "Goal A"\n  input: "A"\n',
    );
    await writeFile(
      path.join(tempDir, 'glob-cases', 'b.yaml'),
      '- id: glob-b\n  criteria: "Goal B"\n  input: "B"\n',
    );

    const cases = await resolveFileReference('file://glob-cases/*.yaml', tempDir);

    expect(cases).toHaveLength(2);
    const ids = cases.map((c) => c.id);
    expect(ids).toContain('glob-a');
    expect(ids).toContain('glob-b');
  });

  it('throws clear error for missing file', async () => {
    await expect(resolveFileReference('file://nonexistent/file.yaml', tempDir)).rejects.toThrow(
      /Cannot read external test file/,
    );
  });

  it('throws clear error for malformed JSONL', async () => {
    await writeFile(path.join(tempDir, 'cases', 'bad.jsonl'), '{"id": "ok"}\n{bad json}\n');

    await expect(resolveFileReference('file://cases/bad.jsonl', tempDir)).rejects.toThrow(
      /Malformed JSONL at line 2/,
    );
  });

  it('warns and returns empty for glob matching nothing', async () => {
    const cases = await resolveFileReference('file://no-match/**/*.yaml', tempDir);
    expect(cases).toHaveLength(0);
  });

  it('warns and returns empty for empty file', async () => {
    await writeFile(path.join(tempDir, 'cases', 'empty.yaml'), '');

    const cases = await resolveFileReference('file://cases/empty.yaml', tempDir);
    expect(cases).toHaveLength(0);
  });
});

describe('expandFileReferences', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-expand-refs-${Date.now()}`);
    await mkdir(path.join(tempDir, 'cases'), { recursive: true });

    await writeFile(
      path.join(tempDir, 'cases', 'extra.yaml'),
      '- id: external-1\n  criteria: "External goal"\n  input: "External input"\n',
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('mixes inline test objects and file:// references', async () => {
    const tests = [
      { id: 'inline-1', criteria: 'Inline goal', input: 'Inline input' },
      'file://cases/extra.yaml',
      { id: 'inline-2', criteria: 'Inline goal 2', input: 'Inline input 2' },
    ];

    const expanded = await expandFileReferences(tests, tempDir);

    expect(expanded).toHaveLength(3);
    expect((expanded[0] as { id: string }).id).toBe('inline-1');
    expect((expanded[1] as { id: string }).id).toBe('external-1');
    expect((expanded[2] as { id: string }).id).toBe('inline-2');
  });
});

describe('loadTests with file:// references', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-file-ref-integration-${Date.now()}`);
    await mkdir(path.join(tempDir, 'cases'), { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads mixed inline and file:// tests from YAML', async () => {
    // Create external YAML test file
    await writeFile(
      path.join(tempDir, 'cases', 'accuracy.yaml'),
      `- id: accuracy-1
  criteria: "Accurate response"
  input: "What is 2+2?"
`,
    );

    // Create external JSONL test file
    await writeFile(
      path.join(tempDir, 'cases', 'regression.jsonl'),
      '{"id": "regression-1", "criteria": "No regression", "input": "Test query"}\n',
    );

    // Create main eval file with file:// references
    await writeFile(
      path.join(tempDir, 'dataset.eval.yaml'),
      `name: test-suite
tests:
  - id: inline-test
    criteria: "Inline goal"
    input: "Hello"
  - file://cases/accuracy.yaml
  - file://cases/regression.jsonl
`,
    );

    const tests = await loadTests(path.join(tempDir, 'dataset.eval.yaml'), tempDir);

    expect(tests).toHaveLength(3);
    expect(tests[0].id).toBe('inline-test');
    expect(tests[1].id).toBe('accuracy-1');
    expect(tests[2].id).toBe('regression-1');
  });

  it('loads tests from glob patterns', async () => {
    const subDir = path.join(tempDir, 'glob-suite');
    await mkdir(path.join(subDir, 'cases'), { recursive: true });

    await writeFile(
      path.join(subDir, 'cases', 'set-a.yaml'),
      '- id: glob-a\n  criteria: "Goal A"\n  input: "Input A"\n',
    );
    await writeFile(
      path.join(subDir, 'cases', 'set-b.yaml'),
      '- id: glob-b\n  criteria: "Goal B"\n  input: "Input B"\n',
    );

    await writeFile(
      path.join(subDir, 'suite.yaml'),
      `tests:
  - file://cases/*.yaml
`,
    );

    const tests = await loadTests(path.join(subDir, 'suite.yaml'), subDir);

    expect(tests).toHaveLength(2);
    const ids = tests.map((t) => t.id);
    expect(ids).toContain('glob-a');
    expect(ids).toContain('glob-b');
  });

  it('resolves paths relative to eval file directory', async () => {
    const nested = path.join(tempDir, 'nested', 'evals');
    await mkdir(path.join(nested, 'data'), { recursive: true });

    await writeFile(
      path.join(nested, 'data', 'cases.yaml'),
      '- id: nested-case\n  criteria: "Nested goal"\n  input: "Nested input"\n',
    );

    await writeFile(
      path.join(nested, 'suite.yaml'),
      `tests:
  - file://data/cases.yaml
`,
    );

    const tests = await loadTests(path.join(nested, 'suite.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('nested-case');
  });

  it('throws for missing file:// reference', async () => {
    await writeFile(
      path.join(tempDir, 'missing-ref.yaml'),
      `tests:
  - file://nonexistent.yaml
`,
    );

    await expect(loadTests(path.join(tempDir, 'missing-ref.yaml'), tempDir)).rejects.toThrow(
      /Cannot read external test file/,
    );
  });

  it('throws for malformed JSONL in file:// reference', async () => {
    await writeFile(
      path.join(tempDir, 'cases', 'malformed.jsonl'),
      '{"id": "ok"}\n{invalid json here}\n',
    );

    await writeFile(
      path.join(tempDir, 'malformed-ref.yaml'),
      `tests:
  - file://cases/malformed.jsonl
`,
    );

    await expect(loadTests(path.join(tempDir, 'malformed-ref.yaml'), tempDir)).rejects.toThrow(
      /Malformed JSONL at line 2/,
    );
  });
});

describe('tests as string path', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-tests-string-path-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads tests from external YAML file', async () => {
    // Create external cases file
    await writeFile(
      path.join(tempDir, 'cases.yaml'),
      `- id: ext-yaml-1
  criteria: "Goal 1"
  input: "Hello"
- id: ext-yaml-2
  criteria: "Goal 2"
  input: "World"
`,
    );

    // Create suite YAML with tests as string path
    await writeFile(
      path.join(tempDir, 'suite.yaml'),
      `name: string-path-suite
tests: ./cases.yaml
`,
    );

    const tests = await loadTests(path.join(tempDir, 'suite.yaml'), tempDir);

    expect(tests).toHaveLength(2);
    expect(tests[0].id).toBe('ext-yaml-1');
    expect(tests[0].criteria).toBe('Goal 1');
    expect(tests[1].id).toBe('ext-yaml-2');
    expect(tests[1].criteria).toBe('Goal 2');
  });

  it('loads tests from external JSONL file', async () => {
    // Create external JSONL cases file
    await writeFile(
      path.join(tempDir, 'cases.jsonl'),
      [
        '{"id": "ext-jsonl-1", "criteria": "JSONL Goal 1", "input": "Query 1"}',
        '{"id": "ext-jsonl-2", "criteria": "JSONL Goal 2", "input": "Query 2"}',
      ].join('\n'),
    );

    // Create suite YAML with tests pointing to JSONL
    await writeFile(
      path.join(tempDir, 'suite-jsonl.yaml'),
      `name: jsonl-string-path
tests: ./cases.jsonl
`,
    );

    const tests = await loadTests(path.join(tempDir, 'suite-jsonl.yaml'), tempDir);

    expect(tests).toHaveLength(2);
    expect(tests[0].id).toBe('ext-jsonl-1');
    expect(tests[1].id).toBe('ext-jsonl-2');
  });

  it('resolves relative path against eval file directory', async () => {
    // Create nested directory structure
    const dirA = path.join(tempDir, 'a');
    const dirB = path.join(tempDir, 'b');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });

    // Create cases in directory b
    await writeFile(
      path.join(dirB, 'cases.yaml'),
      `- id: relative-path-test
  criteria: "Relative path goal"
  input: "Input"
`,
    );

    // Create suite in directory a, referencing ../b/cases.yaml
    await writeFile(
      path.join(dirA, 'suite.yaml'),
      `name: relative-path-suite
tests: ../b/cases.yaml
`,
    );

    const tests = await loadTests(path.join(dirA, 'suite.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('relative-path-test');
  });

  it('throws on non-existent external file', async () => {
    await writeFile(
      path.join(tempDir, 'missing-tests.yaml'),
      `name: missing-suite
tests: ./nonexistent.yaml
`,
    );

    await expect(loadTests(path.join(tempDir, 'missing-tests.yaml'), tempDir)).rejects.toThrow(
      /Cannot read external test file/,
    );
  });

  it('preserves suite-level metadata when using string path', async () => {
    await writeFile(
      path.join(tempDir, 'meta-cases.yaml'),
      `- id: meta-test
  criteria: "Meta goal"
  input: "Meta input"
`,
    );

    await writeFile(
      path.join(tempDir, 'meta-suite.yaml'),
      `name: meta-suite
description: A suite with external tests
tests: ./meta-cases.yaml
`,
    );

    const result = await loadTestSuite(path.join(tempDir, 'meta-suite.yaml'), tempDir);

    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].id).toBe('meta-test');
    expect(result.metadata?.name).toBe('meta-suite');
    expect(result.metadata?.description).toBe('A suite with external tests');
  });

  it('loads tests from string path without ./ prefix', async () => {
    await writeFile(
      path.join(tempDir, 'bare-cases.yaml'),
      `- id: bare-path-test
  criteria: "Bare path goal"
  input: "Input"
`,
    );

    await writeFile(
      path.join(tempDir, 'bare-suite.yaml'),
      `name: bare-path-suite
tests: bare-cases.yaml
`,
    );

    const tests = await loadTests(path.join(tempDir, 'bare-suite.yaml'), tempDir);

    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('bare-path-test');
  });
});
