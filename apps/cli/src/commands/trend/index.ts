import path from 'node:path';

import { command, flag, number, oneOf, option, optional, restPositionals, string } from 'cmd-ts';

import { toSnakeCaseDeep } from '../../utils/case-conversion.js';
import { RESULT_INDEX_FILENAME } from '../eval/result-layout.js';
import {
  type LightweightResultRecord,
  loadLightweightResults,
  resolveResultSourcePath,
} from '../results/manifest.js';
import { listResultFiles } from '../trace/utils.js';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
const c = noColor ? Object.fromEntries(Object.keys(colors).map((k) => [k, ''])) : colors;
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export interface TrendRunRecord extends LightweightResultRecord {
  readonly sourcePath: string;
}

export interface TrendRunPoint {
  readonly label: string;
  readonly path: string;
  readonly timestamp?: string;
  readonly matchedTestCount: number;
  readonly meanScore: number;
}

export interface TrendFilters {
  readonly dataset?: string;
  readonly target?: string;
  readonly allowMissingTests: boolean;
}

export interface TrendSummary {
  readonly runCount: number;
  readonly matchedTestCount: number;
  readonly dateRange: {
    readonly start?: string;
    readonly end?: string;
  };
  readonly slope: number;
  readonly intercept: number;
  readonly rSquared: number;
  readonly direction: 'degrading' | 'improving' | 'stable';
}

export interface TrendRegression {
  readonly slopeThreshold: number;
  readonly failOnDegrading: boolean;
  readonly triggered: boolean;
}

export interface TrendOutput {
  readonly runs: readonly TrendRunPoint[];
  readonly filters: TrendFilters;
  readonly summary: TrendSummary;
  readonly regression: TrendRegression;
}

interface RegressionStats {
  readonly slope: number;
  readonly intercept: number;
  readonly rSquared: number;
}

function stripAnsi(str: string): string {
  return str.replace(ansiPattern, '');
}

function padRight(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return str + ' '.repeat(Math.max(0, len - plainLen));
}

function padLeft(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return ' '.repeat(Math.max(0, len - plainLen)) + str;
}

function formatSignedNumber(value: number, digits = 3): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

function colorizeDirection(direction: TrendSummary['direction']): string {
  switch (direction) {
    case 'improving':
      return `${c.green}${direction}${c.reset}`;
    case 'degrading':
      return `${c.red}${direction}${c.reset}`;
    case 'stable':
      return `${c.gray}${direction}${c.reset}`;
  }
}

function colorizeSlope(value: number): string {
  if (value > 0) {
    return `${c.green}${formatSignedNumber(value)}${c.reset}`;
  }
  if (value < 0) {
    return `${c.red}${formatSignedNumber(value)}${c.reset}`;
  }
  return `${c.gray}${formatSignedNumber(value)}${c.reset}`;
}

function ensureTrendIndexPath(source: string, cwd: string): string {
  const resolved = resolveResultSourcePath(source, cwd);
  if (path.basename(resolved) !== RESULT_INDEX_FILENAME) {
    throw new Error(
      `Unsupported result source for trend: ${source}. Use a run workspace directory or ${RESULT_INDEX_FILENAME} manifest.`,
    );
  }
  return resolved;
}

export function resolveTrendSources(
  cwd: string,
  sources: readonly string[],
  last?: number,
): string[] {
  if (sources.length > 0 && last !== undefined) {
    throw new Error('Use either explicit run sources or --last, not both');
  }

  if (sources.length > 0) {
    return sources.map((source) => ensureTrendIndexPath(source, cwd));
  }

  if (last === undefined) {
    throw new Error('Provide one or more run workspaces or use --last <n>');
  }

  if (last < 2) {
    throw new Error('--last must be at least 2');
  }

  const metas = listResultFiles(cwd)
    .filter((meta) => path.basename(meta.path) === RESULT_INDEX_FILENAME)
    .slice(0, last);

  if (metas.length < 2) {
    throw new Error(
      'Trend analysis requires at least 2 canonical run workspaces in .agentv/results/runs/',
    );
  }

  return metas.map((meta) => meta.path).reverse();
}

function filterRunRecords(
  records: readonly LightweightResultRecord[],
  sourcePath: string,
  dataset?: string,
  target?: string,
): TrendRunRecord[] {
  return records
    .filter((record) => (dataset ? record.dataset === dataset : true))
    .filter((record) => (target ? record.target === target : true))
    .map((record) => ({ ...record, sourcePath }));
}

function getRunLabel(sourcePath: string, timestamp?: string): string {
  if (timestamp) {
    return timestamp;
  }
  return path.basename(path.dirname(sourcePath));
}

function getRunSortKey(sourcePath: string, timestamp?: string): string {
  return timestamp ?? path.basename(path.dirname(sourcePath));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

export function computeMatchedTestIds(
  runs: readonly TrendRunRecord[][],
  allowMissingTests: boolean,
): string[] | undefined {
  if (allowMissingTests) {
    return undefined;
  }

  const [firstRun, ...rest] = runs;
  const intersection = new Set(firstRun.map((record) => record.testId));

  for (const run of rest) {
    const runIds = new Set(run.map((record) => record.testId));
    for (const testId of intersection) {
      if (!runIds.has(testId)) {
        intersection.delete(testId);
      }
    }
  }

  return [...intersection].sort();
}

export function computeRegressionStats(values: readonly number[]): RegressionStats {
  if (values.length < 2) {
    throw new Error('Trend analysis requires at least 2 runs');
  }

  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = mean(values);

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    numerator += dx * (values[i] - meanY);
    denominator += dx * dx;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * i;
    ssTot += (values[i] - meanY) ** 2;
    ssRes += (values[i] - predicted) ** 2;
  }

  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, rSquared };
}

export function classifyTrendDirection(
  slope: number,
  slopeThreshold: number,
): TrendSummary['direction'] {
  if (slope <= -slopeThreshold) {
    return 'degrading';
  }
  if (slope >= slopeThreshold) {
    return 'improving';
  }
  return 'stable';
}

export function determineTrendExitCode(
  direction: TrendSummary['direction'],
  failOnDegrading: boolean,
): number {
  return failOnDegrading && direction === 'degrading' ? 1 : 0;
}

export function analyzeTrend(params: {
  readonly sourcePaths: readonly string[];
  readonly dataset?: string;
  readonly target?: string;
  readonly slopeThreshold: number;
  readonly allowMissingTests: boolean;
  readonly failOnDegrading: boolean;
}): TrendOutput {
  const { sourcePaths, dataset, target, slopeThreshold, allowMissingTests, failOnDegrading } =
    params;

  if (sourcePaths.length < 2) {
    throw new Error('Trend analysis requires at least 2 runs');
  }

  const filteredRuns = sourcePaths.map((sourcePath) => {
    const records = filterRunRecords(
      loadLightweightResults(sourcePath),
      sourcePath,
      dataset,
      target,
    );
    if (records.length === 0) {
      const filters = [dataset ? `dataset=${dataset}` : '', target ? `target=${target}` : '']
        .filter(Boolean)
        .join(', ');
      const suffix = filters ? ` after filtering by ${filters}` : '';
      throw new Error(`Run has no matching records${suffix}: ${sourcePath}`);
    }
    return records;
  });

  const chronologicalRuns = filteredRuns
    .map((records, index) => ({
      sourcePath: sourcePaths[index],
      records,
      sortKey: getRunSortKey(sourcePaths[index], records[0]?.timestamp),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const matchedTestIds = computeMatchedTestIds(
    chronologicalRuns.map((run) => run.records),
    allowMissingTests,
  );
  if (!allowMissingTests && (!matchedTestIds || matchedTestIds.length === 0)) {
    throw new Error('No shared test IDs remain across the selected runs after filtering');
  }

  const runs = chronologicalRuns.map(({ records, sourcePath }) => {
    const applicableRecords =
      matchedTestIds === undefined
        ? records
        : records.filter((record) => matchedTestIds.includes(record.testId));

    if (applicableRecords.length === 0) {
      throw new Error(`Run has no matched tests after intersection: ${sourcePath}`);
    }

    return {
      label: getRunLabel(sourcePath, applicableRecords[0]?.timestamp ?? records[0]?.timestamp),
      path: sourcePath,
      timestamp: applicableRecords[0]?.timestamp ?? records[0]?.timestamp,
      matchedTestCount: applicableRecords.length,
      meanScore: roundMetric(mean(applicableRecords.map((record) => record.score))),
    } satisfies TrendRunPoint;
  });

  const regressionStats = computeRegressionStats(runs.map((run) => run.meanScore));
  const direction = classifyTrendDirection(regressionStats.slope, slopeThreshold);

  return {
    runs,
    filters: {
      dataset,
      target,
      allowMissingTests,
    },
    summary: {
      runCount: runs.length,
      matchedTestCount:
        matchedTestIds?.length ?? Math.min(...runs.map((run) => run.matchedTestCount)),
      dateRange: {
        start: runs[0]?.timestamp,
        end: runs.at(-1)?.timestamp,
      },
      slope: roundMetric(regressionStats.slope),
      intercept: roundMetric(regressionStats.intercept),
      rSquared: roundMetric(regressionStats.rSquared),
      direction,
    },
    regression: {
      slopeThreshold,
      failOnDegrading,
      triggered: failOnDegrading && direction === 'degrading',
    },
  };
}

export function formatTrendTable(output: TrendOutput): string {
  const lines: string[] = [];
  const runLabelWidth = Math.max(3, ...output.runs.map((run) => run.label.length));
  const scoreWidth = Math.max(10, ...output.runs.map((run) => run.meanScore.toFixed(3).length));
  const matchWidth = Math.max(7, ...output.runs.map((run) => String(run.matchedTestCount).length));

  lines.push('');
  lines.push(`${c.bold}Trend Analysis${c.reset}`);
  lines.push('');
  lines.push(
    `${c.bold}Runs:${c.reset} ${output.summary.runCount} | ${c.bold}Range:${c.reset} ${output.summary.dateRange.start ?? 'unknown'} → ${output.summary.dateRange.end ?? 'unknown'}`,
  );
  lines.push(
    `${c.bold}Filters:${c.reset} dataset=${output.filters.dataset ?? '*'} target=${output.filters.target ?? '*'} mode=${output.filters.allowMissingTests ? 'independent' : 'matched-tests'}`,
  );
  lines.push(
    `${c.bold}Matched Tests:${c.reset} ${output.summary.matchedTestCount} | ${c.bold}Verdict:${c.reset} ${colorizeDirection(output.summary.direction)}`,
  );
  lines.push('');

  const header = `  ${padRight('Run', runLabelWidth)}  ${padLeft('Tests', matchWidth)}  ${padLeft('Mean Score', scoreWidth)}`;
  lines.push(`${c.dim}${header}${c.reset}`);
  lines.push(
    `${c.dim}  ${'─'.repeat(runLabelWidth)}  ${'─'.repeat(matchWidth)}  ${'─'.repeat(scoreWidth)}${c.reset}`,
  );

  for (const run of output.runs) {
    lines.push(
      `  ${padRight(run.label, runLabelWidth)}  ${padLeft(String(run.matchedTestCount), matchWidth)}  ${padLeft(run.meanScore.toFixed(3), scoreWidth)}`,
    );
  }

  lines.push('');
  lines.push(
    `${c.bold}Summary:${c.reset} slope=${colorizeSlope(output.summary.slope)} intercept=${output.summary.intercept.toFixed(3)} r²=${output.summary.rSquared.toFixed(3)}`,
  );
  lines.push(
    `${c.bold}Regression Gate:${c.reset} threshold=${output.regression.slopeThreshold.toFixed(3)} fail_on_degrading=${output.regression.failOnDegrading ? 'true' : 'false'} triggered=${output.regression.triggered ? `${c.red}true${c.reset}` : 'false'}`,
  );
  lines.push('');

  return lines.join('\n');
}

export const trendCommand = command({
  name: 'trend',
  description: 'Analyze score drift across multiple historical run manifests',
  args: {
    runs: restPositionals({
      type: string,
      displayName: 'runs',
      description: 'Run workspace directories or index.jsonl manifest paths',
    }),
    last: option({
      type: optional(number),
      long: 'last',
      description: 'Use the most recent N runs from .agentv/results/runs/',
    }),
    dataset: option({
      type: optional(string),
      long: 'dataset',
      description: 'Filter records to a dataset name',
    }),
    target: option({
      type: optional(string),
      long: 'target',
      description: 'Filter records to a target name',
    }),
    slopeThreshold: option({
      type: optional(number),
      long: 'slope-threshold',
      description: 'Minimum absolute slope required to classify improving or degrading',
    }),
    failOnDegrading: flag({
      long: 'fail-on-degrading',
      description: 'Exit non-zero when the detected trend is degrading beyond the slope threshold',
    }),
    allowMissingTests: flag({
      long: 'allow-missing-tests',
      description: 'Aggregate each run independently instead of intersecting test IDs across runs',
    }),
    format: option({
      type: optional(oneOf(['table', 'json'])),
      long: 'format',
      short: 'f',
      description: 'Output format: table (default) or json',
    }),
    json: flag({
      long: 'json',
      description: 'Output JSON format (shorthand for --format=json)',
    }),
  },
  handler: async ({
    runs,
    last,
    dataset,
    target,
    slopeThreshold,
    failOnDegrading,
    allowMissingTests,
    format,
    json,
  }) => {
    const outputFormat = json ? 'json' : (format ?? 'table');
    const effectiveSlopeThreshold = slopeThreshold ?? 0.01;

    try {
      if (effectiveSlopeThreshold < 0) {
        throw new Error('--slope-threshold must be non-negative');
      }

      const sourcePaths = resolveTrendSources(process.cwd(), runs, last);
      const output = analyzeTrend({
        sourcePaths,
        dataset,
        target,
        slopeThreshold: effectiveSlopeThreshold,
        allowMissingTests,
        failOnDegrading,
      });

      if (outputFormat === 'json') {
        console.log(JSON.stringify(toSnakeCaseDeep(output), null, 2));
      } else {
        console.log(formatTrendTable(output));
      }

      process.exit(determineTrendExitCode(output.summary.direction, failOnDegrading));
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
