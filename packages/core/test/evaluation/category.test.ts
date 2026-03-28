import { describe, expect, test } from 'bun:test';

import { DEFAULT_CATEGORY, deriveCategory } from '../../src/evaluation/category.js';

describe('deriveCategory', () => {
  test('returns Uncategorized for single-segment path (root-level file)', () => {
    expect(deriveCategory('dataset.eval.yaml')).toBe(DEFAULT_CATEGORY);
  });

  test('returns Uncategorized when only directory is evals', () => {
    expect(deriveCategory('evals/dataset.eval.yaml')).toBe(DEFAULT_CATEGORY);
  });

  test('strips evals segment and returns remaining directory', () => {
    expect(deriveCategory('evals/fundamentals/greetings.eval.yaml')).toBe('fundamentals');
  });

  test('preserves nested directory paths', () => {
    expect(deriveCategory('evals/cargowise-customs/layout-engine/eval.yaml')).toBe(
      'cargowise-customs/layout-engine',
    );
  });

  test('handles paths without evals segment', () => {
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
});
