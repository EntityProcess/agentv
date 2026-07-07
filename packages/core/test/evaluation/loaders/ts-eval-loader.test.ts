import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import {
  isTypeScriptEvalConfigFileName,
  loadTsEvalFile,
} from '../../../src/evaluation/loaders/ts-eval-loader.js';
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

  it('rejects named config exports', async () => {
    await expect(loadTsEvalFile(path.join(fixtureDir, 'named-config.eval.ts'))).rejects.toThrow(
      'Export an EvalConfig as the default export',
    );
    await expect(
      loadTsEvalFile(path.join(fixtureDir, 'eval-config-named.eval.ts')),
    ).rejects.toThrow('Export an EvalConfig as the default export');
  });

  it('loads YAML-aligned sdk eval exports', async () => {
    const result = await loadTsEvalFile(path.join(fixtureDir, 'sdk-define-eval.eval.ts'));
    const tests = (result.config as { tests?: Array<{ id?: string }> }).tests;
    expect(result.config).toBeDefined();
    expect(tests?.[0]?.id).toBe('sdk-define-eval');
  });

  it('throws when no supported eval export is found', async () => {
    await expect(loadTsEvalFile(path.join(fixtureDir, 'no-config.eval.ts'))).rejects.toThrow(
      'default export',
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

  it('materializes *.eval.ts default exports with relative imports', async () => {
    const suite = await loadTestSuite(path.join(fixtureDir, 'relative-import.eval.ts'), fixtureDir);

    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0].id).toBe('relative-import');
    expect(suite.tests[0].input).toEqual([{ role: 'user', content: 'Say hello' }]);
    expect(suite.targetRefs).toEqual([{ name: 'mock-target' }]);
    expect(suite.budgetUsd).toBe(1);
    expect(suite.experimentConfig?.repeat?.count).toBe(2);
    expect(suite.tags).toEqual({ experiment: 'ts-config', group: 'loader' });
  });

  it('materializes *.eval.mts default exports', async () => {
    const suite = await loadTestSuite(path.join(fixtureDir, 'module.eval.mts'), fixtureDir);

    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0].id).toBe('module-mts-config');
  });

  it('reports invalid TypeScript eval contracts through suite loading', async () => {
    await expect(
      loadTestSuite(path.join(fixtureDir, 'invalid-contract.eval.ts'), fixtureDir),
    ).rejects.toThrow('providers[0].id');
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
    expect(suite.targetRefs).toEqual([{ name: 'mock-target' }]);
    expect(suite.targets).toEqual(['mock-target']);
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

  it('recognizes only explicit TypeScript eval config filenames', () => {
    expect(isTypeScriptEvalConfigFileName('promptfooconfig.ts')).toBe(false);
    expect(isTypeScriptEvalConfigFileName('promptfooconfig.mts')).toBe(false);
    expect(isTypeScriptEvalConfigFileName('agentvconfig.ts')).toBe(false);
    expect(isTypeScriptEvalConfigFileName('agentvconfig.mts')).toBe(false);
    expect(isTypeScriptEvalConfigFileName('suite.eval.ts')).toBe(true);
    expect(isTypeScriptEvalConfigFileName('suite.eval.mts')).toBe(true);
    expect(isTypeScriptEvalConfigFileName('.agentv/assertions/custom-check.ts')).toBe(false);
    expect(isTypeScriptEvalConfigFileName('helpers/custom-check.ts')).toBe(false);
  });
});
