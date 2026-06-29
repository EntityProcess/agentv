import { describe, expect, it } from 'bun:test';

import { buildCategoryTree, flattenCategoryTree, normalizeCategoryPath } from './category-tree';
import type { EvalResult } from './types';

function result(overrides: Partial<EvalResult>): EvalResult {
  return {
    testId: overrides.testId ?? 'case',
    suite: overrides.suite ?? 'suite',
    category: overrides.category,
    score: overrides.score ?? 1,
    ...overrides,
  };
}

describe('category tree model', () => {
  it('builds parent rollups from slash-delimited category metadata', () => {
    const tree = buildCategoryTree(
      [
        result({ testId: 'network-pass', category: 'security/network', score: 1 }),
        result({ testId: 'security-fail', category: 'security', score: 0 }),
        result({ testId: 'quality-pass', category: 'quality/regression', score: 0.9 }),
      ],
      0.8,
    );

    const nodes = flattenCategoryTree(tree);
    const security = nodes.find((node) => node.name === 'security');
    const network = nodes.find((node) => node.name === 'security/network');

    expect(tree.map((node) => node.name)).toEqual(['quality', 'security']);
    expect(security).toMatchObject({
      name: 'security',
      label: 'security',
      total: 2,
      passed: 1,
      failed: 1,
      childCount: 1,
    });
    expect(network).toMatchObject({
      name: 'security/network',
      label: 'network',
      parent: 'security',
      depth: 1,
      total: 1,
      passed: 1,
    });
  });

  it('preserves existing flat categories as one-node paths', () => {
    const tree = buildCategoryTree(
      [result({ testId: 'flat', category: 'Safety > PII', score: 0.5 })],
      0.8,
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      name: 'Safety > PII',
      label: 'Safety > PII',
      total: 1,
      failed: 1,
      children: [],
    });
  });

  it('canonicalizes explicit slash category strings', () => {
    expect(normalizeCategoryPath(' security / network ')).toBe('security/network');
    expect(normalizeCategoryPath('security\\network')).toBe('security/network');
  });
});
