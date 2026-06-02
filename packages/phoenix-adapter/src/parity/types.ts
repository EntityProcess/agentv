export interface SuiteRunSummary {
  readonly source: string;
  readonly datasetName: string;
  readonly testCount: number;
  readonly baselineCount?: number;
  readonly warningCount: number;
  readonly unsupportedFeatures: readonly string[];
  readonly phoenixExperimentId?: string;
  readonly phoenixRunCount?: number;
  readonly phoenixEvaluationRunCount?: number;
  readonly status: 'passed' | 'failed';
  readonly failures: readonly string[];
}

export interface RunReport {
  readonly generatedAt: string;
  readonly dryRun: boolean;
  readonly agentvRoot: string;
  readonly suiteCount: number;
  readonly testCount: number;
  readonly passedSuites: number;
  readonly failedSuites: number;
  readonly unsupportedFeatures: readonly string[];
  readonly suites: readonly SuiteRunSummary[];
}
