import {
  type BenchmarkSummary,
  type GradingSummary,
  type ResultEntry,
  type TimingSummary,
  readBenchmarkSummary,
  readGradingSummary,
  readResults,
  readTimingSummary,
} from './artifact-readers.js';

export interface ReviewSection {
  heading: string;
  body: string;
}

export interface TestCase {
  id: string;
  status: 'pass' | 'fail' | 'error';
  summary: string;
  score?: number;
  rationale?: string;
  error?: string;
}

export interface ReviewModel {
  title: string;
  sections: ReviewSection[];
  testCases: TestCase[];
  metadata?: {
    timestamp?: string;
    eval_file?: string;
    targets?: string[];
  };
}

export interface BuildReviewOptions {
  gradingPath: string;
  benchmarkPath: string;
  timingPath: string;
  resultsPath: string;
}

/**
 * Builds a review model from existing AgentV artifacts, including per-test rows from results JSONL.
 */
export function buildReviewModel(options: BuildReviewOptions): ReviewModel {
  const { gradingPath, benchmarkPath, timingPath, resultsPath } = options;

  const grading = readGradingSummary(gradingPath);
  const benchmark = readBenchmarkSummary(benchmarkPath);
  const timing = readTimingSummary(timingPath);
  const results = readResults(resultsPath);

  // Build summary sections
  const sections: ReviewSection[] = [];

  // Add benchmark summary
  const targets = Object.entries(benchmark.targets);
  if (targets.length > 0) {
    const [targetName, targetStats] = targets[0];
    sections.push({
      heading: 'Benchmark Summary',
      body: `Target: ${targetName}\nPass Rate: ${(targetStats.pass_rate.mean * 100).toFixed(1)}%\nAvg Time: ${targetStats.time_seconds.mean.toFixed(2)}s\nAvg Tokens: ${targetStats.tokens.mean.toFixed(0)}`,
    });
  }

  // Add timing summary
  sections.push({
    heading: 'Timing',
    body: `Total Duration: ${timing.total_duration_seconds.toFixed(2)}s\nTotal Tokens: ${timing.total_tokens}\nInput: ${timing.token_usage.input} | Output: ${timing.token_usage.output}`,
  });

  // Build test cases from results
  const testCases: TestCase[] = results.map((result) => {
    const gradingEntry = grading[result.test_id];
    const status: 'pass' | 'fail' | 'error' =
      result.error || result.execution_status === 'execution_error'
        ? 'error'
        : result.score > 0
          ? 'pass'
          : 'fail';

    return {
      id: result.test_id,
      status,
      summary: result.input.substring(0, 100),
      score: gradingEntry?.score ?? result.score,
      rationale: gradingEntry?.rationale ?? undefined,
      error: result.error ?? gradingEntry?.error,
    };
  });

  return {
    title: 'AgentV Evaluation Report',
    sections,
    testCases,
    metadata: {
      timestamp: benchmark.metadata.timestamp,
      eval_file: benchmark.metadata.eval_file,
      targets: benchmark.metadata.targets,
    },
  };
}
