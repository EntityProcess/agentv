import { describe, expect, it } from 'bun:test';
import type { EvaluationResult } from '@agentv/core';

import { patchTestIds } from '../../../src/commands/results/shared.js';

describe('patchTestIds', () => {
  it('passes through results with testId', () => {
    const results = [{ testId: 'test-1', score: 1 }] as unknown as EvaluationResult[];
    expect(patchTestIds(results)).toEqual(results);
  });

  it('patches evalId to testId for backward compatibility', () => {
    const results = [{ evalId: 'old-1', score: 1 }] as unknown as EvaluationResult[];
    const patched = patchTestIds(results);
    expect(patched[0].testId).toBe('old-1');
  });

  it('preserves all other fields when patching evalId', () => {
    const results = [
      { evalId: 'old-1', score: 0.8, target: 'gpt-4o', timestamp: '2026-01-01' },
    ] as unknown as EvaluationResult[];
    const patched = patchTestIds(results);
    expect(patched[0]).toEqual({
      evalId: 'old-1',
      score: 0.8,
      target: 'gpt-4o',
      timestamp: '2026-01-01',
      testId: 'old-1',
    });
  });

  it('does not overwrite existing testId with evalId', () => {
    const results = [
      { testId: 'test-1', evalId: 'old-1', score: 1 },
    ] as unknown as EvaluationResult[];
    const patched = patchTestIds(results);
    expect(patched[0].testId).toBe('test-1');
  });

  it('handles empty array', () => {
    expect(patchTestIds([])).toEqual([]);
  });
});
