import { describe, expect, it } from 'bun:test';

import {
  ALL_DISTRIBUTION_FILTER_VALUE,
  type ScoreDistributionFilters,
  buildScoreDistributionModel,
} from './score-distribution';
import type { CompareResponse } from './types';

const NOW = new Date('2026-06-08T12:00:00.000Z');

function filters(overrides: Partial<ScoreDistributionFilters> = {}): ScoreDistributionFilters {
  return {
    experiment: ALL_DISTRIBUTION_FILTER_VALUE,
    category: ALL_DISTRIBUTION_FILTER_VALUE,
    timePeriod: 'all',
    ...overrides,
  };
}

function compareFixture(): CompareResponse {
  return {
    experiments: ['exp-b', 'exp-a'],
    targets: ['gpt-4o'],
    cells: [],
    runs: [
      {
        run_id: 'recent',
        started_at: '2026-06-08T10:00:00.000Z',
        experiment: 'exp-b',
        target: 'gpt-4o',
        source: 'local',
        eval_count: 2,
        quality_count: 2,
        passed_count: 1,
        execution_error_count: 0,
        pass_rate: 0.5,
        avg_score: 0.65,
        tests: [
          { test_id: 'recent-safety', category: 'safety', score: 0.45, passed: false },
          { test_id: 'recent-quality', category: 'quality', score: 0.85, passed: true },
        ],
      },
      {
        run_id: 'old',
        started_at: '2026-05-01T10:00:00.000Z',
        experiment: 'exp-a',
        target: 'gpt-4o',
        source: 'local',
        eval_count: 2,
        quality_count: 2,
        passed_count: 1,
        execution_error_count: 0,
        pass_rate: 0.5,
        avg_score: 0.55,
        tests: [
          { test_id: 'old-safety', category: 'safety', score: 0.25, passed: false },
          { test_id: 'old-quality', category: 'quality', score: 0.95, passed: true },
        ],
      },
    ],
  };
}

describe('buildScoreDistributionModel', () => {
  it('derives experiment and category options from compare samples', () => {
    const model = buildScoreDistributionModel(compareFixture(), filters(), NOW);

    expect(model.experimentOptions).toEqual([
      { value: 'exp-a', label: 'exp-a', count: 2 },
      { value: 'exp-b', label: 'exp-b', count: 2 },
    ]);
    expect(model.categoryAvailable).toBe(true);
    expect(model.categoryOptions).toEqual([
      { value: 'quality', label: 'quality', count: 2 },
      { value: 'safety', label: 'safety', count: 2 },
    ]);
  });

  it('builds buckets from the selected experiment, category, and time window', () => {
    const model = buildScoreDistributionModel(
      compareFixture(),
      filters({ experiment: 'exp-b', category: 'safety', timePeriod: '24h' }),
      NOW,
    );

    expect(model.totalScores).toBe(4);
    expect(model.filteredScores).toBe(1);
    expect(model.buckets.filter((bucket) => bucket.count > 0)).toEqual([
      { range: '40-50%', count: 1 },
    ]);
  });

  it('returns empty buckets when no scores match the selected slice', () => {
    const model = buildScoreDistributionModel(
      compareFixture(),
      filters({ experiment: 'exp-a', timePeriod: '24h' }),
      NOW,
    );

    expect(model.totalScores).toBe(4);
    expect(model.filteredScores).toBe(0);
    expect(model.buckets).toEqual([]);
  });

  it('reports category metadata as unavailable when compare tests do not carry it', () => {
    const data = compareFixture();
    data.runs = data.runs?.map((run) => ({
      ...run,
      tests: run.tests.map(({ category: _category, ...test }) => test),
    }));

    const model = buildScoreDistributionModel(data, filters(), NOW);

    expect(model.categoryAvailable).toBe(false);
    expect(model.categoryOptions).toEqual([]);
    expect(model.filteredScores).toBe(4);
  });
});
