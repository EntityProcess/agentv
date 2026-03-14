import { readFileSync } from 'node:fs';

export interface BenchmarkSummary {
  metadata: {
    eval_file: string;
    timestamp: string;
    targets: string[];
    tests_run: string[];
  };
  targets: Record<
    string,
    {
      pass_rate: { mean: number; stddev: number };
      time_seconds: { mean: number; stddev: number };
      tokens: { mean: number; stddev: number };
    }
  >;
  run_summary?: Record<
    string,
    {
      pass_rate: { mean: number; stddev: number };
      time_seconds: { mean: number; stddev: number };
      tokens: { mean: number; stddev: number };
    }
  >;
  notes?: string[];
}

export interface GradingSummary {
  [testId: string]: {
    test_id: string;
    score: number | null;
    rationale: string | null;
    error?: string;
  };
}

export interface TimingSummary {
  total_tokens: number;
  duration_ms: number;
  total_duration_seconds: number;
  token_usage: {
    input: number;
    output: number;
  };
}

export interface ResultEntry {
  timestamp: string;
  test_id: string;
  score: number;
  hits: string[];
  misses: string[];
  answer: string;
  target: string;
  requests: Record<string, unknown>;
  input: string;
  error?: string;
  execution_status?: string;
  failure_stage?: string;
  failure_reason_code?: string;
  execution_error?: {
    message: string;
    stage: string;
  };
}

export function readBenchmarkSummary(path: string): BenchmarkSummary {
  const content = readFileSync(path, 'utf-8');
  const data = JSON.parse(content);

  // Handle both old and new formats
  if (data.run_summary && !data.targets) {
    return {
      ...data,
      targets: data.run_summary,
    };
  }

  return data as BenchmarkSummary;
}

export function readGradingSummary(path: string): GradingSummary {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as GradingSummary;
}

export function readTimingSummary(path: string): TimingSummary {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as TimingSummary;
}

export function readResults(path: string): ResultEntry[] {
  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n');
  return lines.map((line) => JSON.parse(line) as ResultEntry);
}
