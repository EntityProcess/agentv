import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_CATEGORY,
  deriveCategory,
  normalizeCategoryPath,
} from '../../src/evaluation/category.js';

describe('deriveCategory', () => {
  test('returns Uncategorized for single-segment path (root-level file)', () => {
    expect(deriveCategory('dataset.eval.yaml')).toBe(DEFAULT_CATEGORY);
  });

  test('uses a meaningful root-level eval filename as a one-node category path', () => {
    expect(deriveCategory('network.eval.yaml')).toBe('network');
  });

  test('returns Uncategorized when only directory is evals', () => {
    expect(deriveCategory('evals/dataset.eval.yaml')).toBe(DEFAULT_CATEGORY);
  });

  test('strips evals segment and appends meaningful named eval files as a leaf', () => {
    expect(deriveCategory('evals/fundamentals/greetings.eval.yaml')).toBe('fundamentals/greetings');
  });

  test('does not append generic eval filenames to nested directory paths', () => {
    expect(deriveCategory('evals/cargowise-customs/layout-engine/eval.yaml')).toBe(
      'cargowise-customs/layout-engine',
    );
  });

  test('handles generic filenames without evals segment', () => {
    expect(deriveCategory('examples/showcase/eval.yaml')).toBe('examples/showcase');
  });

  test('strips evals from middle of multi-level path', () => {
    expect(deriveCategory('examples/showcase/export-screening/evals/dataset.eval.yaml')).toBe(
      'examples/showcase/export-screening',
    );
  });

  test('returns Uncategorized for empty string', () => {
    expect(deriveCategory('')).toBe(DEFAULT_CATEGORY);
  });

  test('returns Uncategorized for just a filename with no directory', () => {
    expect(deriveCategory('eval.yaml')).toBe(DEFAULT_CATEGORY);
  });

  test('matches the hierarchical category derivation contract', () => {
    expect(deriveCategory('security/eval.yaml')).toBe('security');
    expect(deriveCategory('security/network.eval.yaml')).toBe('security/network');
    expect(deriveCategory('security/network/dataset.eval.yaml')).toBe('security/network');
  });
});

describe('normalizeCategoryPath', () => {
  test('canonicalizes explicit slash-delimited taxonomy paths', () => {
    expect(normalizeCategoryPath(' security / network ')).toBe('security/network');
    expect(normalizeCategoryPath('security//network')).toBe('security/network');
    expect(normalizeCategoryPath('security\\network')).toBe('security/network');
  });

  test('preserves existing flat category strings as one-node paths', () => {
    expect(normalizeCategoryPath('Safety > PII')).toBe('Safety > PII');
  });

  test('returns Uncategorized for empty explicit categories', () => {
    expect(normalizeCategoryPath('  /  ')).toBe(DEFAULT_CATEGORY);
    expect(normalizeCategoryPath(undefined)).toBe(DEFAULT_CATEGORY);
  });
});
