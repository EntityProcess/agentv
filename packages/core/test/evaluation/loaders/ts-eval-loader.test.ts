import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { loadTsEvalFile } from '../../../src/evaluation/loaders/ts-eval-loader.js';
import { loadTestSuite, loadTests } from '../../../src/evaluation/yaml-parser.js';

const fixtureDir = path.join(import.meta.dir, 'fixtures');

describe('loadTsEvalFile', () => {
  it('loads default export', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'default-export.eval.ts'));
    const tests = (result.config as { tests?: Array<{ id?: string }> }).tests;
    expect(result.config).toBeDefined();
    expect(tests).toHaveLength(1);
    expect(tests?.[0]?.id).toBe('greeting');
  });

  it('loads named "config" export', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'named-config.eval.ts'));
    const tests = (result.config as { tests?: Array<{ id?: string }> }).tests;
    expect(result.config).toBeDefined();
    expect(tests?.[0]?.id).toBe('named-config');
  });

  it('loads named "evalConfig" export', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'eval-config-named.eval.ts'));
    const tests = (result.config as { tests?: Array<{ id?: string }> }).tests;
    expect(result.config).toBeDefined();
    expect(tests?.[0]?.id).toBe('eval-config-named');
  });

  it('loads YAML-aligned sdk eval exports', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'sdk-define-eval.eval.ts'));
    const tests = (result.config as { tests?: Array<{ id?: string }> }).tests;
    expect(result.config).toBeDefined();
    expect(tests?.[0]?.id).toBe('sdk-define-eval');
  });

  it('throws when no supported eval export is found', async () => {
    await expect(loadTsEvalFile(path.join(fixtureDir, 'no-config.eval.ts'))).rejects.toThrow(
      'no supported eval export found',
    );
  });

  it('returns absolute file path', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'default-export.eval.ts'));
    expect(path.isAbsolute(result.filePath)).toBe(true);
    expect(result.filePath).toContain('default-export.eval.ts');
  });

  it('materializes a TS eval through loadTestSuite', async () => {
    const suite = await loadTestSuite(path.join(fixtureDir, 'default-export.eval.ts'), fixtureDir, {
      category: 'sdk',
    });
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0].suite).toBe('default-export-suite');
    expect(suite.tests[0].category).toBe('sdk');
    expect(suite.metadata?.tags).toEqual(['sdk', 'typescript']);
    expect(suite.cacheConfig?.enabled).toBe(false);
    expect(suite.cacheConfig?.cachePath).toBe('.agentv/ts-eval-cache');
    expect(suite.budgetUsd).toBe(1.5);
    expect(suite.threshold).toBe(0.9);
    expect(suite.inlineTarget?.name).toBe('inline-target');
  });

  it('materializes a YAML-aligned sdk eval through loadTestSuite', async () => {
    const suite = await loadTestSuite(
      path.join(fixtureDir, 'sdk-define-eval.eval.ts'),
      fixtureDir,
      {
        category: 'sdk',
      },
    );

    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0].suite).toBe('sdk-define-eval-suite');
    expect(suite.tests[0].workspace?.hooks?.before_all?.command).toEqual(['echo', 'suite-setup']);
    expect(suite.tests[0].workspace?.hooks?.before_each?.command).toEqual(['echo', 'case-setup']);
    expect(suite.tests[0].workspace?.hooks?.before_each?.timeout_ms).toBe(1_000);
    expect(suite.targetSpec).toEqual({ name: 'mock-target' });
    expect(suite.targets).toBeUndefined();
    expect(suite.workers).toBeUndefined();
    expect(suite.budgetUsd).toBe(2);
    expect(suite.threshold).toBe(0.75);
    expect(suite.metadata?.tags).toEqual(['sdk', 'typescript', 'yaml']);
  });

  it('routes TypeScript evals through loadTests', async () => {
    const tests = await loadTests(path.join(fixtureDir, 'default-export.eval.ts'), fixtureDir, {
      category: 'sdk',
    });
    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('greeting');
    expect(tests[0].category).toBe('sdk');
  });
});
