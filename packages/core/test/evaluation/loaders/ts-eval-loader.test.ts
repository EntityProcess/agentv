import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { loadTsEvalFile } from '../../../src/evaluation/loaders/ts-eval-loader.js';
import { loadTestSuite, loadTests } from '../../../src/evaluation/yaml-parser.js';

const fixtureDir = path.join(import.meta.dir, 'fixtures');

describe('loadTsEvalFile', () => {
  it('loads default export', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'default-export.eval.ts'));
    expect(result.config).toBeDefined();
    expect(result.config.tests).toHaveLength(1);
    expect(result.config.tests?.[0].id).toBe('greeting');
  });

  it('loads named "config" export', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'named-config.eval.ts'));
    expect(result.config).toBeDefined();
    expect(result.config.tests?.[0].id).toBe('named-config');
  });

  it('loads named "evalConfig" export', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'eval-config-named.eval.ts'));
    expect(result.config).toBeDefined();
    expect(result.config.tests?.[0].id).toBe('eval-config-named');
  });

  it('throws when no EvalConfig export found', async () => {
    await expect(loadTsEvalFile(path.join(fixtureDir, 'no-config.eval.ts'))).rejects.toThrow(
      'no EvalConfig export found',
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
    expect(suite.workers).toBe(2);
    expect(suite.cacheConfig?.enabled).toBe(false);
    expect(suite.budgetUsd).toBe(1.5);
    expect(suite.threshold).toBe(0.9);
    expect(suite.inlineTarget?.name).toBe('inline-target');
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
