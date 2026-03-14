import {
  type BenchmarkSummary,
  type ResultEntry,
  type TimingSummary,
  readBenchmarkSummary,
  readResults,
  readTimingSummary,
} from './artifact-readers.js';

export interface AggregateOptions {
  benchmarkPath: string;
  timingPath: string;
  resultsPath?: string;
}

export interface AggregateSummary {
  targets: Record<
    string,
    {
      pass_rate: { mean: number; stddev: number };
      time_seconds: { mean: number; stddev: number };
      tokens: { mean: number; stddev: number };
    }
  >;
  timing: TimingSummary;
  results?: ResultEntry[];
  metadata: BenchmarkSummary['metadata'];
}

/**
 * Aggregates pass-rate and timing metrics from benchmark artifacts.
 * Accepts explicit benchmarkPath, timingPath, and optional resultsPath.
 */
export function aggregateBenchmarks(options: AggregateOptions): AggregateSummary {
  const { benchmarkPath, timingPath, resultsPath } = options;

  const benchmark = readBenchmarkSummary(benchmarkPath);
  const timing = readTimingSummary(timingPath);
  const results = resultsPath ? readResults(resultsPath) : undefined;

  return {
    targets: benchmark.targets,
    timing,
    results,
    metadata: benchmark.metadata,
  };
}
