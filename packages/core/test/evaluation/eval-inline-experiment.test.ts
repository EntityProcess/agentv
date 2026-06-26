import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadTestSuite } from '../../src/evaluation/yaml-parser.js';

describe('eval.yaml inline experiment and tests imports', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentv-inline-experiment-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses top-level experiment as the canonical runtime block', async () => {
    const evalPath = path.join(tempDir, 'runtime.eval.yaml');
    await writeFile(
      evalPath,
      [
        'experiment:',
        '  targets: [codex, claude]',
        '  workers: 2',
        '  threshold: 0.7',
        '  repeat:',
        '    count: 2',
        '    strategy: mean',
        '  timeout_seconds: 30',
        '  budget_usd: 1.5',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.experimentConfig).toMatchObject({
      targets: ['codex', 'claude'],
      workers: 2,
      threshold: 0.7,
      repeat: { count: 2, strategy: 'mean' },
      timeoutSeconds: 30,
      budgetUsd: 1.5,
    });
    expect(suite.targets).toEqual(['codex', 'claude']);
    expect(suite.workers).toBe(2);
  });

  it('accepts top-level execution as a legacy runtime alias but rejects both blocks', async () => {
    const legacyPath = path.join(tempDir, 'legacy.eval.yaml');
    await writeFile(
      legacyPath,
      [
        'execution:',
        '  target: mock',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const legacy = await loadTestSuite(legacyPath, tempDir);
    expect(legacy.experimentConfig?.target).toBe('mock');
    expect(legacy.targets).toBeUndefined();

    const conflictPath = path.join(tempDir, 'conflict.eval.yaml');
    await writeFile(
      conflictPath,
      [
        'experiment:',
        '  target: codex',
        'execution:',
        '  target: claude',
        'tests:',
        '  - id: one',
        '    input: hello',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    await expect(loadTestSuite(conflictPath, tempDir)).rejects.toThrow(/experiment.*execution/);
  });

  it('globs raw case files through tests[].include with deterministic ordering and select filters', async () => {
    const casesDir = path.join(tempDir, 'cases');
    await mkdir(casesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'b.cases.yaml'),
      [
        '- id: b-2',
        '  input: b2',
        '  criteria: ok',
        '- id: b-1',
        '  input: b1',
        '  criteria: ok',
      ].join('\n'),
    );
    await writeFile(
      path.join(casesDir, 'a.cases.yaml'),
      ['- id: a-1', '  input: a1', '  criteria: ok'].join('\n'),
    );
    await writeFile(path.join(casesDir, 'c.jsonl'), '{"id":"c-1","input":"c1","criteria":"ok"}\n');
    const evalPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      evalPath,
      [
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      test_ids: ["a-*", "b-1"]',
        '  - include: cases/*.jsonl',
        '    type: tests',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['a-1', 'b-1', 'c-1']);
  });

  it('keeps raw-case shorthand imports for tests strings and list entries', async () => {
    const casesDir = path.join(tempDir, 'cases');
    const suitesDir = path.join(tempDir, 'suites');
    await mkdir(casesDir, { recursive: true });
    await mkdir(suitesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'a.cases.yaml'),
      '- id: a-1\n  input: a1\n  criteria: ok\n',
    );
    await writeFile(
      path.join(casesDir, 'b.cases.yaml'),
      '- id: b-1\n  input: b1\n  criteria: ok\n',
    );
    await writeFile(path.join(casesDir, 'c.jsonl'), '{"id":"c-1","input":"c1","criteria":"ok"}\n');
    await writeFile(
      path.join(suitesDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'tests:',
        '  - id: suite-1',
        '    input: suite',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const topLevelPath = path.join(tempDir, 'top-level.eval.yaml');
    await writeFile(topLevelPath, 'tests: cases/*.cases.yaml\n');
    const topLevelSuite = await loadTestSuite(topLevelPath, tempDir);
    expect(topLevelSuite.tests.map((test) => test.id)).toEqual(['a-1', 'b-1']);

    const mixedPath = path.join(tempDir, 'mixed.eval.yaml');
    await writeFile(
      mixedPath,
      [
        'tests:',
        '  - cases/*.jsonl',
        '  - include: suites/*.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );
    const mixedSuite = await loadTestSuite(mixedPath, tempDir);
    expect(mixedSuite.tests.map((test) => test.id)).toEqual(['suite-1', 'c-1']);
    expect(mixedSuite.tests[0]?.suite).toBe('child-suite');
    expect(mixedSuite.tests[0]?.source?.importedSuiteName).toBe('child-suite');

    const invalidPath = path.join(tempDir, 'invalid.eval.yaml');
    await writeFile(invalidPath, 'tests: suites/*.eval.yaml\n');
    await expect(loadTestSuite(invalidPath, tempDir)).rejects.toThrow(
      /shorthand imports raw case files only/,
    );
  });

  it('rejects direct circular suite imports', async () => {
    const evalPath = path.join(tempDir, 'self.eval.yaml');
    await writeFile(
      evalPath,
      ['name: self', 'tests:', '  - include: self.eval.yaml', '    type: suite', ''].join('\n'),
    );

    await expect(loadTestSuite(evalPath, tempDir)).rejects.toThrow(
      /Circular eval suite import: .*self\.eval\.yaml -> .*self\.eval\.yaml/,
    );
  });

  it('rejects indirect circular suite imports with the import chain', async () => {
    const aPath = path.join(tempDir, 'a.eval.yaml');
    const bPath = path.join(tempDir, 'b.eval.yaml');
    await writeFile(
      aPath,
      ['name: a', 'tests:', '  - include: b.eval.yaml', '    type: suite', ''].join('\n'),
    );
    await writeFile(
      bPath,
      ['name: b', 'tests:', '  - include: a.eval.yaml', '    type: suite', ''].join('\n'),
    );

    await expect(loadTestSuite(aPath, tempDir)).rejects.toThrow(
      /Circular eval suite import: .*a\.eval\.yaml -> .*b\.eval\.yaml -> .*a\.eval\.yaml/,
    );
  });

  it('allows sibling re-imports of the same suite', async () => {
    const childPath = path.join(tempDir, 'child.eval.yaml');
    await writeFile(
      childPath,
      [
        'name: child',
        'tests:',
        '  - id: child-case',
        '    input: child',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['child-case', 'child-case']);
  });

  it('loads deep non-cyclic suite import chains', async () => {
    const aPath = path.join(tempDir, 'chain-a.eval.yaml');
    const bPath = path.join(tempDir, 'chain-b.eval.yaml');
    const cPath = path.join(tempDir, 'chain-c.eval.yaml');
    await writeFile(
      aPath,
      ['name: chain-a', 'tests:', '  - include: chain-b.eval.yaml', '    type: suite', ''].join(
        '\n',
      ),
    );
    await writeFile(
      bPath,
      ['name: chain-b', 'tests:', '  - include: chain-c.eval.yaml', '    type: suite', ''].join(
        '\n',
      ),
    );
    await writeFile(
      cPath,
      [
        'name: chain-c',
        'tests:',
        '  - id: c-case',
        '    input: deepest',
        '    criteria: ok',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(aPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['c-case']);
    expect(suite.tests[0]?.suite).toBe('chain-c');
    expect(suite.tests[0]?.source?.importedSuiteName).toBe('chain-c');
    expect(suite.tests[0]?.source?.evalFileAbsolutePath).toBe(cPath);
  });

  it('filters include entries by tags and metadata selectors', async () => {
    const casesDir = path.join(tempDir, 'cases');
    await mkdir(casesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'selected.cases.yaml'),
      [
        '- id: selected',
        '  input: selected',
        '  criteria: ok',
        '  metadata:',
        '    tags: [sql-migration, review]',
        '    type: e2e',
        '    priority: high',
        '- id: wrong-priority',
        '  input: wrong',
        '  criteria: ok',
        '  metadata:',
        '    tags: [sql-migration]',
        '    type: e2e',
        '    priority: low',
      ].join('\n'),
    );
    const evalPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      evalPath,
      [
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      tags: sql-*',
        '      metadata:',
        '        type: [e2e, regression]',
        '        priority: high',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(evalPath, tempDir);

    expect(suite.tests.map((test) => test.id)).toEqual(['selected']);
  });

  it('select.tags filters effective case metadata tags including suite identity tags', async () => {
    const casesDir = path.join(tempDir, 'cases');
    await mkdir(casesDir, { recursive: true });
    await writeFile(
      path.join(casesDir, 'cases.cases.yaml'),
      [
        '- id: inherited-tag',
        '  input: inherited',
        '  criteria: ok',
        '- id: case-tag',
        '  input: case',
        '  criteria: ok',
        '  metadata:',
        '    tags: [review]',
      ].join('\n'),
    );
    const inheritedPath = path.join(tempDir, 'inherited.eval.yaml');
    await writeFile(
      inheritedPath,
      [
        'tags: [suite-identity]',
        'metadata:',
        '  tags: [sql-migration]',
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      tags: sql-*',
        '',
      ].join('\n'),
    );

    const inheritedSuite = await loadTestSuite(inheritedPath, tempDir);
    expect(inheritedSuite.tests.map((test) => test.id)).toEqual(['inherited-tag', 'case-tag']);
    expect(inheritedSuite.tests[1]?.metadata?.tags).toEqual([
      'suite-identity',
      'sql-migration',
      'review',
    ]);

    const identityPath = path.join(tempDir, 'identity.eval.yaml');
    await writeFile(
      identityPath,
      [
        'tags: [suite-identity]',
        'tests:',
        '  - include: cases/*.cases.yaml',
        '    type: tests',
        '    select:',
        '      tags: suite-identity',
        '',
      ].join('\n'),
    );

    const identitySuite = await loadTestSuite(identityPath, tempDir);
    expect(identitySuite.tests.map((test) => test.id)).toEqual(['inherited-tag', 'case-tag']);
    expect(identitySuite.tests[0]?.metadata?.tags).toEqual(['suite-identity']);
  });

  it('type: suite preserves child suite context and ignores child runtime config', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'experiment:',
        '  target: child-target',
        'workspace:',
        '  path: ./child-workspace',
        'input: child shared input',
        'assertions:',
        '  - type: contains',
        '    value: child',
        'tests:',
        '  - id: child-case',
        '    input: child case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'experiment:',
        '  target: parent-target',
        'workspace:',
        '  path: ./parent-workspace',
        'input: parent shared input',
        'assertions:',
        '  - type: contains',
        '    value: parent',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const test = suite.tests[0];

    expect(suite.experimentConfig?.target).toBe('parent-target');
    expect(test.suite).toBe('child-suite');
    expect(test.workspace?.path).toBe('./child-workspace');
    expect(test.input.map((message) => message.content)).toEqual([
      'child shared input',
      'child case input',
    ]);
    expect(test.assertions?.[0]?.type).toBe('contains');
    expect(test.assertions?.[0]).toMatchObject({ value: 'child' });
  });

  it('applies scoped run overrides with test.run taking precedence over tests[].run', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'experiment:',
        '  threshold: 0.2',
        '  repeat:',
        '    count: 5',
        'tests:',
        '  - id: child-default',
        '    input: default',
        '    criteria: ok',
        '  - id: child-critical',
        '    input: critical',
        '    criteria: ok',
        '    run:',
        '      threshold: 1.0',
        '      repeat:',
        '        count: 1',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'experiment:',
        '  threshold: 0.8',
        '  repeat:',
        '    count: 3',
        '    strategy: pass_at_k',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: suite',
        '    run:',
        '      threshold: 0.9',
        '      repeat:',
        '        count: 2',
        '        strategy: pass_all',
        '      timeout_seconds: 30',
        '      budget_usd: 1.25',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const byId = new Map(suite.tests.map((test) => [test.id, test]));

    expect(suite.experimentConfig?.threshold).toBe(0.8);
    expect(suite.experimentConfig?.repeat).toMatchObject({ count: 3, strategy: 'pass_at_k' });
    expect(byId.get('child-default')?.run).toMatchObject({
      threshold: 0.9,
      repeat: { count: 2, strategy: 'pass_all' },
      timeoutSeconds: 30,
      budgetUsd: 1.25,
    });
    expect(byId.get('child-critical')?.run).toMatchObject({
      threshold: 1.0,
      repeat: { count: 1 },
      timeoutSeconds: 30,
      budgetUsd: 1.25,
    });
    expect(byId.get('child-critical')?.threshold).toBe(1.0);
  });

  it('type: tests imports only raw cases and applies parent suite context', async () => {
    await writeFile(
      path.join(tempDir, 'child.eval.yaml'),
      [
        'name: child-suite',
        'input: child shared input',
        'assertions:',
        '  - type: contains',
        '    value: child',
        'tests:',
        '  - id: raw-case',
        '    input: raw case input',
        '    criteria: ok',
        '',
      ].join('\n'),
    );
    const parentPath = path.join(tempDir, 'parent.eval.yaml');
    await writeFile(
      parentPath,
      [
        'name: parent-suite',
        'input: parent shared input',
        'assertions:',
        '  - type: contains',
        '    value: parent',
        'tests:',
        '  - include: child.eval.yaml',
        '    type: tests',
        '',
      ].join('\n'),
    );

    const suite = await loadTestSuite(parentPath, tempDir);
    const test = suite.tests[0];

    expect(test.suite).toBe('parent-suite');
    expect(test.input.map((message) => message.content)).toEqual([
      'parent shared input',
      'raw case input',
    ]);
    expect(test.assertions?.[0]).toMatchObject({ type: 'contains', value: 'parent' });
  });
});
