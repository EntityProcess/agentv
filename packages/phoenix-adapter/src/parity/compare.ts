import type { NormalizedSuite } from '../agentv/types.js';
import { unsupportedEvaluatorReports } from '../evaluators/registry.js';
import type { NormalizedAssertionConfig } from '../evaluators/types.js';
import type { PhoenixDatasetPayload } from '../phoenix/types.js';
import { readBaselineSummary } from './baselines.js';
import type { SuiteRunSummary } from './types.js';

export function compareDryRunSuite(
  suite: NormalizedSuite,
  dataset: PhoenixDatasetPayload,
): SuiteRunSummary {
  const failures: string[] = [];
  const baseline = readBaselineSummary(suite.source.path);
  const caseIds = new Set(suite.cases.map((testCase) => testCase.id));
  const unsupportedFeatures = [
    ...suite.unsupportedFeatures,
    ...unsupportedEvaluatorReports(
      suite.cases.flatMap((testCase) => testCase.assertions.map(toAssertionConfig)),
    ).map((report) => `${report.type}: ${report.name}`),
  ];

  if (dataset.examples.length !== suite.cases.length) {
    failures.push(
      `Dataset example count ${dataset.examples.length} does not match case count ${suite.cases.length}`,
    );
  }

  if (baseline) {
    const baselineIds = new Set(baseline.testIds);
    for (const id of baselineIds) {
      if (!caseIds.has(id))
        failures.push(`Baseline test id is missing from converted suite: ${id}`);
    }
    for (const id of caseIds) {
      if (!baselineIds.has(id)) failures.push(`Converted test id is missing from baseline: ${id}`);
    }
  }

  if (suite.cases.length === 0) failures.push('Suite contains no normalized cases');

  return {
    source: suite.source.relativePath,
    datasetName: dataset.name,
    testCount: suite.cases.length,
    baselineCount: baseline?.testIds.length,
    warningCount: suite.warnings.length,
    unsupportedFeatures: [...new Set(unsupportedFeatures)].sort(),
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
  };
}

function toAssertionConfig(assertion: {
  readonly type: string;
  readonly name?: string;
  readonly source: unknown;
}): NormalizedAssertionConfig {
  if (
    assertion.source &&
    typeof assertion.source === 'object' &&
    !Array.isArray(assertion.source)
  ) {
    return {
      ...(assertion.source as Record<string, unknown>),
      type: assertion.type,
      name: assertion.name,
    };
  }
  return {
    type: assertion.type,
    name: assertion.name,
    value: assertion.source,
  };
}
