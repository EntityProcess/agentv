import { scoreToVerdict } from './evaluators/scoring.js';
import type {
  ConfidenceIntervalAggregation,
  EvaluationVerdict,
  MeanAggregation,
  PassAtKAggregation,
  TrialAggregation,
  TrialResult,
  TrialsConfig,
} from './types.js';

/**
 * Aggregate trial results into a final score, verdict, and aggregation metadata.
 */
export function aggregateTrials(
  trials: readonly TrialResult[],
  config: TrialsConfig,
): { score: number; verdict: EvaluationVerdict; aggregation: TrialAggregation } {
  switch (config.strategy) {
    case 'pass_at_k':
      return aggregatePassAtK(trials);
    case 'mean':
      return aggregateMean(trials);
    case 'confidence_interval':
      return aggregateConfidenceInterval(trials);
  }
}

function aggregatePassAtK(trials: readonly TrialResult[]): {
  score: number;
  verdict: EvaluationVerdict;
  aggregation: PassAtKAggregation;
} {
  const passedAttempts = trials.filter((t) => t.verdict === 'pass').length;
  const bestTrial = trials.reduce((best, t) => (t.score > best.score ? t : best), trials[0]);

  const aggregation: PassAtKAggregation = {
    strategy: 'pass_at_k',
    passedAttempts,
    totalAttempts: trials.length,
  };

  return {
    score: bestTrial.score,
    verdict: bestTrial.verdict,
    aggregation,
  };
}

function aggregateMean(trials: readonly TrialResult[]): {
  score: number;
  verdict: EvaluationVerdict;
  aggregation: MeanAggregation;
} {
  const scores = trials.map((t) => t.score);
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  const aggregation: MeanAggregation = {
    strategy: 'mean',
    mean,
    min,
    max,
  };

  return {
    score: mean,
    verdict: scoreToVerdict(mean),
    aggregation,
  };
}

function aggregateConfidenceInterval(trials: readonly TrialResult[]): {
  score: number;
  verdict: EvaluationVerdict;
  aggregation: ConfidenceIntervalAggregation;
} {
  const scores = trials.map((t) => t.score);
  const n = scores.length;
  const mean = scores.reduce((sum, s) => sum + s, 0) / n;

  if (n < 2) {
    // Cannot compute CI with fewer than 2 samples
    const aggregation: ConfidenceIntervalAggregation = {
      strategy: 'confidence_interval',
      mean,
      ci95Lower: clamp01(mean),
      ci95Upper: clamp01(mean),
      stddev: 0,
    };
    return { score: mean, verdict: scoreToVerdict(mean), aggregation };
  }

  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  const standardError = stddev / Math.sqrt(n);
  const tCritical = getTCritical(n - 1);
  const margin = tCritical * standardError;

  const aggregation: ConfidenceIntervalAggregation = {
    strategy: 'confidence_interval',
    mean,
    ci95Lower: clamp01(mean - margin),
    ci95Upper: clamp01(mean + margin),
    stddev,
  };

  // Use the lower bound of the CI as the conservative score
  return {
    score: aggregation.ci95Lower,
    verdict: scoreToVerdict(aggregation.ci95Lower),
    aggregation,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Two-tailed t-distribution critical values for 95% confidence (alpha = 0.05).
 * Index is degrees of freedom (df). For df >= 30, uses z = 1.96.
 */
const T_TABLE_95: readonly number[] = [
  // df=0 is unused placeholder
  12.706, // df=1
  4.303, // df=2
  3.182, // df=3
  2.776, // df=4
  2.571, // df=5
  2.447, // df=6
  2.365, // df=7
  2.306, // df=8
  2.262, // df=9
  2.228, // df=10
  2.201, // df=11
  2.179, // df=12
  2.16, // df=13
  2.145, // df=14
  2.131, // df=15
  2.12, // df=16
  2.11, // df=17
  2.101, // df=18
  2.093, // df=19
  2.086, // df=20
  2.08, // df=21
  2.074, // df=22
  2.069, // df=23
  2.064, // df=24
  2.06, // df=25
  2.056, // df=26
  2.052, // df=27
  2.048, // df=28
  2.045, // df=29
];

/**
 * Get the t-critical value for a given degrees of freedom at 95% confidence.
 */
export function getTCritical(df: number): number {
  if (df < 1) return 12.706;
  if (df >= 30) return 1.96;
  return T_TABLE_95[df - 1];
}
