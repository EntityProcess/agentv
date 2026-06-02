import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunReport, SuiteRunSummary } from './types.js';

export function buildRunReport(input: {
  readonly dryRun: boolean;
  readonly agentvRoot: string;
  readonly suites: readonly SuiteRunSummary[];
}): RunReport {
  const unsupported = new Set<string>();
  for (const suite of input.suites) {
    for (const feature of suite.unsupportedFeatures) unsupported.add(feature);
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun: input.dryRun,
    agentvRoot: input.agentvRoot,
    suiteCount: input.suites.length,
    testCount: input.suites.reduce((sum, suite) => sum + suite.testCount, 0),
    passedSuites: input.suites.filter((suite) => suite.status === 'passed').length,
    failedSuites: input.suites.filter((suite) => suite.status === 'failed').length,
    unsupportedFeatures: [...unsupported].sort(),
    suites: input.suites,
  };
}

export async function writeJsonReport(report: RunReport, outPath: string): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function formatMarkdownReport(report: RunReport): string {
  const lines = [
    '# Phoenix AgentV Eval Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Dry run: ${String(report.dryRun)}`,
    `Suites: ${report.suiteCount}`,
    `Tests: ${report.testCount}`,
    `Passed suites: ${report.passedSuites}`,
    `Failed suites: ${report.failedSuites}`,
    '',
    '| Status | Source | Tests | Baseline | Unsupported |',
    '| --- | --- | ---: | ---: | --- |',
  ];

  for (const suite of report.suites) {
    lines.push(
      `| ${suite.status} | \`${suite.source}\` | ${suite.testCount} | ${suite.baselineCount ?? ''} | ${suite.unsupportedFeatures.join(', ')} |`,
    );
    if (suite.phoenixExperimentId) {
      lines.push(
        `|  | Phoenix experiment \`${suite.phoenixExperimentId}\` | ${suite.phoenixRunCount ?? ''} | ${suite.phoenixEvaluationRunCount ?? ''} |  |`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}
