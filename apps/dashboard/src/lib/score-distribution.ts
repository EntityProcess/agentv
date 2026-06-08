/**
 * Score distribution helpers for the Dashboard Analytics chart.
 *
 * The chart needs to slice score samples by experiment, category, and run
 * timestamp before building histogram buckets. Keep that logic here so the
 * Recharts component only renders controls and data. To add another filter:
 * extend `ScoreDistributionFilters`, update `collectScoreSamples` if a new
 * metadata field is needed, then filter samples in `buildScoreDistributionModel`.
 */

import type { CompareResponse, CompareRunEntry, CompareTestResult } from './types';

export const ALL_DISTRIBUTION_FILTER_VALUE = '';

export type ScoreDistributionTimePeriod = 'all' | '24h' | '7d' | '30d';

export const SCORE_DISTRIBUTION_TIME_PERIODS: Array<{
  value: ScoreDistributionTimePeriod;
  label: string;
  windowMs?: number;
}> = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24h', windowMs: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7d', windowMs: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: 'Last 30d', windowMs: 30 * 24 * 60 * 60 * 1000 },
];

export interface ScoreDistributionFilters {
  experiment: string;
  category: string;
  timePeriod: ScoreDistributionTimePeriod;
}

export interface ScoreDistributionOption {
  value: string;
  label: string;
  count: number;
}

export interface ScoreDistributionBucket {
  range: string;
  count: number;
}

export interface ScoreDistributionModel {
  buckets: ScoreDistributionBucket[];
  experimentOptions: ScoreDistributionOption[];
  categoryOptions: ScoreDistributionOption[];
  totalScores: number;
  filteredScores: number;
  categoryAvailable: boolean;
  hasTimestampedScores: boolean;
}

interface ScoreSample {
  score: number;
  experiment: string;
  category?: string;
  startedAtMs?: number;
}

const BUCKET_COUNT = 10;

export function buildScoreDistributionModel(
  data: CompareResponse,
  filters: ScoreDistributionFilters,
  now = new Date(),
): ScoreDistributionModel {
  const samples = collectScoreSamples(data);
  const experimentOptions = buildExperimentOptions(data, samples);
  const categoryOptions = buildOptions(samples.flatMap((sample) => sample.category ?? []));
  const categoryAvailable = categoryOptions.length > 0;
  const hasTimestampedScores = samples.some((sample) => sample.startedAtMs !== undefined);
  const activePeriod =
    SCORE_DISTRIBUTION_TIME_PERIODS.find((period) => period.value === filters.timePeriod) ??
    SCORE_DISTRIBUTION_TIME_PERIODS[0];
  const windowStartMs =
    activePeriod.windowMs === undefined ? undefined : now.getTime() - activePeriod.windowMs;

  const filtered = samples.filter((sample) => {
    if (filters.experiment && sample.experiment !== filters.experiment) return false;
    if (filters.category && sample.category !== filters.category) return false;
    if (windowStartMs !== undefined) {
      return sample.startedAtMs !== undefined && sample.startedAtMs >= windowStartMs;
    }
    return true;
  });

  return {
    buckets: buildBuckets(filtered.map((sample) => sample.score)),
    experimentOptions,
    categoryOptions,
    totalScores: samples.length,
    filteredScores: filtered.length,
    categoryAvailable,
    hasTimestampedScores,
  };
}

function collectScoreSamples(data: CompareResponse): ScoreSample[] {
  if (data.runs && data.runs.length > 0) {
    return data.runs.flatMap((run) => collectRunSamples(run));
  }

  return data.cells.flatMap((cell) =>
    cell.tests.flatMap((test) => {
      const sample = scoreSampleFromTest(test, cell.experiment);
      return sample ? [sample] : [];
    }),
  );
}

function collectRunSamples(run: CompareRunEntry): ScoreSample[] {
  const startedAtMs = parseTimestamp(run.started_at);
  return run.tests.flatMap((test) => {
    const sample = scoreSampleFromTest(test, run.experiment);
    return sample ? [{ ...sample, startedAtMs }] : [];
  });
}

function scoreSampleFromTest(
  test: CompareTestResult,
  experiment: string,
): Omit<ScoreSample, 'startedAtMs'> | undefined {
  if (!Number.isFinite(test.score)) return undefined;
  const category = normalizeCategory(test.category);
  return {
    score: test.score,
    experiment,
    ...(category && { category }),
  };
}

function buildExperimentOptions(
  data: CompareResponse,
  samples: ScoreSample[],
): ScoreDistributionOption[] {
  const counts = new Map<string, number>();
  const experimentValues = new Set(data.experiments);
  for (const cell of data.cells) experimentValues.add(cell.experiment);
  for (const sample of samples) {
    experimentValues.add(sample.experiment);
    counts.set(sample.experiment, (counts.get(sample.experiment) ?? 0) + 1);
  }
  return [...experimentValues]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value, count: counts.get(value) ?? 0 }));
}

function buildOptions(values: string[]): ScoreDistributionOption[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, count]) => ({ value, label: value, count }));
}

function buildBuckets(scores: number[]): ScoreDistributionBucket[] {
  if (scores.length === 0) return [];

  const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    range: `${i * 10}-${(i + 1) * 10}%`,
    count: 0,
  }));
  for (const score of scores) {
    const normalized = Math.max(0, Math.min(score, 1));
    const idx = Math.min(Math.floor(normalized * BUCKET_COUNT), BUCKET_COUNT - 1);
    buckets[idx].count++;
  }
  return buckets;
}

function normalizeCategory(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseTimestamp(value: string): number | undefined {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
