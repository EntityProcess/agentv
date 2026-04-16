import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { loadTsEvalFile } from '../../../src/evaluation/loaders/ts-eval-loader.js';

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
});
