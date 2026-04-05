import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

import {
  analyzeTrend,
  classifyTrendDirection,
  computeRegressionStats,
  determineTrendExitCode,
  resolveTrendSources,
} from '../../../src/commands/trend/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../..');
const CLI_ENTRY = path.join(projectRoot, 'apps/cli/src/cli.ts');

interface RunRecordInput {
  readonly test_id: string;
  readonly score: number;
  readonly dataset?: string;
  readonly target?: string;
  readonly timestamp?: string;
}

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'agentv-trend-test-'));
}

async function createRunWorkspace(
  rootDir: string,
  runName: string,
  records: readonly RunRecordInput[],
): Promise<{ runDir: string; indexPath: string }> {
  const runDir = path.join(rootDir, '.agentv', 'results', 'runs', runName);
  await mkdir(runDir, { recursive: true });
  const indexPath = path.join(runDir, 'index.jsonl');
  await writeFile(
    indexPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  );
  return { runDir, indexPath };
}

describe('trend command', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('computes a degrading trend over matched tests after dataset and target filtering', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    const run1 = await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'code-review',
        target: 'claude-sonnet',
        score: 0.95,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'code-review',
        target: 'claude-sonnet',
        score: 0.85,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
      {
        test_id: 't1',
        dataset: 'code-review',
        target: 'gpt-5',
        score: 0.7,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
    ]);
    const run2 = await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'code-review',
        target: 'claude-sonnet',
        score: 0.85,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'code-review',
        target: 'claude-sonnet',
        score: 0.75,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
      {
        test_id: 't1',
        dataset: 'code-review',
        target: 'gpt-5',
        score: 0.8,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    ]);
    const run3 = await createRunWorkspace(cwd, '2026-03-15T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'code-review',
        target: 'claude-sonnet',
        score: 0.75,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'code-review',
        target: 'claude-sonnet',
        score: 0.65,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
      {
        test_id: 't1',
        dataset: 'code-review',
        target: 'gpt-5',
        score: 0.9,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    ]);

    const output = analyzeTrend({
      sourcePaths: [run1.indexPath, run2.indexPath, run3.indexPath],
      dataset: 'code-review',
      target: 'claude-sonnet',
      slopeThreshold: 0.01,
      allowMissingTests: false,
      failOnDegrading: false,
    });

    expect(output.runs).toHaveLength(3);
    expect(output.runs[0]?.meanScore).toBeCloseTo(0.9, 10);
    expect(output.runs[1]?.meanScore).toBeCloseTo(0.8, 10);
    expect(output.runs[2]?.meanScore).toBeCloseTo(0.7, 10);
    expect(output.summary.matchedTestCount).toBe(2);
    expect(output.summary.slope).toBeCloseTo(-0.1, 10);
    expect(output.summary.direction).toBe('degrading');
    expect(output.regression.triggered).toBe(false);
  });

  it('supports independent run aggregation when missing tests are allowed', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    const run1 = await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.8,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.6,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
    ]);
    const run2 = await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.9,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    ]);

    const output = analyzeTrend({
      sourcePaths: [run1.indexPath, run2.indexPath],
      dataset: 'suite',
      target: 'alpha',
      slopeThreshold: 0.01,
      allowMissingTests: true,
      failOnDegrading: false,
    });

    expect(output.filters.allowMissingTests).toBe(true);
    expect(output.runs.map((run) => run.matchedTestCount)).toEqual([2, 1]);
    expect(output.summary.direction).toBe('improving');
  });

  it('rejects runs that have no matching records after target filtering', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    const run1 = await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.8,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
    ]);
    const run2 = await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'beta',
        score: 0.7,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    ]);

    expect(() =>
      analyzeTrend({
        sourcePaths: [run1.indexPath, run2.indexPath],
        dataset: 'suite',
        target: 'alpha',
        slopeThreshold: 0.01,
        allowMissingTests: false,
        failOnDegrading: false,
      }),
    ).toThrow('Run has no matching records');
  });

  it('rejects legacy flat jsonl inputs', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    const flatFile = path.join(cwd, 'results.jsonl');
    await writeFile(flatFile, `${JSON.stringify({ test_id: 't1', score: 0.9 })}\n`, 'utf8');

    expect(() => resolveTrendSources(cwd, [flatFile])).toThrow(
      'Unsupported result source for trend',
    );
  });

  it('discovers canonical run workspaces with --last ordering oldest to newest', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      { test_id: 't1', score: 0.8, timestamp: '2026-03-01T10:00:00.000Z' },
    ]);
    await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      { test_id: 't1', score: 0.85, timestamp: '2026-03-08T10:00:00.000Z' },
    ]);
    await createRunWorkspace(cwd, '2026-03-15T10-00-00-000Z', [
      { test_id: 't1', score: 0.9, timestamp: '2026-03-15T10:00:00.000Z' },
    ]);

    const sources = resolveTrendSources(cwd, [], 2);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain('2026-03-08T10-00-00-000Z');
    expect(sources[1]).toContain('2026-03-15T10-00-00-000Z');
  });

  it('classifies direction and exit code using the slope threshold', () => {
    const stats = computeRegressionStats([0.9, 0.8, 0.7]);
    const direction = classifyTrendDirection(stats.slope, 0.01);

    expect(direction).toBe('degrading');
    expect(determineTrendExitCode(direction, false)).toBe(0);
    expect(determineTrendExitCode(direction, true)).toBe(1);
  });

  it('emits JSON output for explicit run inputs', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    const run1 = await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.9,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.8,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
    ]);
    const run2 = await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.8,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.7,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    ]);
    const run3 = await createRunWorkspace(cwd, '2026-03-15T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.7,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.6,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    ]);

    const result = await execa(
      'bun',
      [
        '--no-env-file',
        CLI_ENTRY,
        'trend',
        run1.runDir,
        run2.indexPath,
        run3.runDir,
        '--dataset',
        'suite',
        '--target',
        'alpha',
        '--json',
      ],
      { cwd, reject: false },
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.filters).toEqual({
      dataset: 'suite',
      target: 'alpha',
      allow_missing_tests: false,
    });
    expect((parsed.summary as Record<string, unknown>).direction).toBe('degrading');
    expect((parsed.summary as Record<string, unknown>).matched_test_count).toBe(2);
  });

  it('normalizes explicit run inputs to chronological order before analysis', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    const run1 = await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.9,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.8,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
    ]);
    const run2 = await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.8,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.7,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    ]);
    const run3 = await createRunWorkspace(cwd, '2026-03-15T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.7,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.6,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    ]);

    const output = analyzeTrend({
      sourcePaths: [run3.runDir, run1.indexPath, run2.runDir],
      dataset: 'suite',
      target: 'alpha',
      slopeThreshold: 0.01,
      allowMissingTests: false,
      failOnDegrading: false,
    });

    expect(output.runs.map((run) => run.timestamp)).toEqual([
      '2026-03-01T10:00:00.000Z',
      '2026-03-08T10:00:00.000Z',
      '2026-03-15T10:00:00.000Z',
    ]);
    expect(output.summary.dateRange).toEqual({
      start: '2026-03-01T10:00:00.000Z',
      end: '2026-03-15T10:00:00.000Z',
    });
    expect(output.summary.direction).toBe('degrading');
  });

  it('uses --last discovery and fails CI gating on sustained degradation', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.95,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.85,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
    ]);
    await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.85,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.75,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    ]);
    await createRunWorkspace(cwd, '2026-03-15T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.75,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
      {
        test_id: 't2',
        dataset: 'suite',
        target: 'alpha',
        score: 0.65,
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    ]);

    const result = await execa(
      'bun',
      [
        '--no-env-file',
        CLI_ENTRY,
        'trend',
        '--last',
        '3',
        '--dataset',
        'suite',
        '--target',
        'alpha',
        '--fail-on-degrading',
        '--slope-threshold',
        '0.01',
      ],
      { cwd, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Trend Analysis');
    expect(result.stdout).toContain('degrading');
  });

  it('errors when target filtering leaves a selected run empty in CLI mode', async () => {
    const cwd = await createTempDir();
    cleanupDirs.push(cwd);

    await createRunWorkspace(cwd, '2026-03-01T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'alpha',
        score: 0.8,
        timestamp: '2026-03-01T10:00:00.000Z',
      },
    ]);
    await createRunWorkspace(cwd, '2026-03-08T10-00-00-000Z', [
      {
        test_id: 't1',
        dataset: 'suite',
        target: 'beta',
        score: 0.7,
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    ]);

    const result = await execa(
      'bun',
      [
        '--no-env-file',
        CLI_ENTRY,
        'trend',
        '--last',
        '2',
        '--dataset',
        'suite',
        '--target',
        'alpha',
      ],
      { cwd, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Run has no matching records');
  });
});
