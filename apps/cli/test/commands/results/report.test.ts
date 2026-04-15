import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import type { EvaluationResult, EvaluatorResult } from '@agentv/core';

import { writeArtifactsFromResults } from '../../../src/commands/eval/artifact-writer.js';
import {
  deriveReportPath,
  loadReportSource,
  writeResultsReport,
} from '../../../src/commands/results/report.js';

function makeScore(
  name: string,
  type: string,
  score: number,
  assertions: EvaluatorResult['assertions'],
): EvaluatorResult {
  return {
    name,
    type,
    score,
    assertions,
    verdict: score >= 0.5 ? 'pass' : 'fail',
  };
}

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2026-04-15T01:00:00.000Z',
    testId: 'test-1',
    suite: 'default',
    score: 1,
    assertions: [{ text: 'fallback assertion', passed: true, evidence: 'ok' }],
    output: [{ role: 'assistant', content: 'answer' }],
    input: [{ role: 'user', content: 'question' }],
    target: 'default',
    executionStatus: 'ok',
    tokenUsage: { input: 100, output: 50 },
    durationMs: 1200,
    ...overrides,
  };
}

describe('results report', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-report-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('derives default report path from the run workspace', () => {
    const sourceFile = path.join(tempDir, 'run', 'index.jsonl');
    expect(deriveReportPath(sourceFile)).toBe(path.join(tempDir, 'run', 'report.html'));
  });

  it('loads benchmark eval file metadata from a run workspace', async () => {
    const runDir = path.join(tempDir, 'run');
    await writeArtifactsFromResults([makeResult()], runDir, { evalFile: 'evals/demo.eval.yaml' });

    const loaded = await loadReportSource(runDir, tempDir);

    expect(loaded.results).toHaveLength(1);
    expect(loaded.benchmarkEvalFile).toBe('demo');
  });

  it('writes a static HTML report with grouped eval files and assertion type badges', async () => {
    const runDir = path.join(tempDir, 'run');
    await writeArtifactsFromResults(
      [
        makeResult({
          testId: 'registry-pass',
          target: 'claude-sonnet',
          scores: [
            makeScore('contains', 'contains', 1, [
              { text: 'mentions registry', passed: true, evidence: 'registry present' },
            ]),
          ],
        }),
        makeResult({
          testId: 'billing-fail',
          target: 'gpt-5.4',
          score: 0.2,
          executionStatus: 'quality_failure',
          scores: [
            makeScore('regex', 'regex', 0.2, [
              { text: 'matches invoice pattern', passed: false, evidence: 'no invoice id' },
            ]),
          ],
        }),
      ],
      runDir,
      { evalFile: 'evals/demo.eval.yaml' },
    );

    const indexPath = path.join(runDir, 'index.jsonl');
    const lines = readFileSync(indexPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    lines[0].eval_file = 'cw-freight-boolean-registry';
    lines[1].eval_file = 'cw-freight-billing';
    writeFileSync(indexPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    const { outputPath } = await writeResultsReport(runDir, undefined, tempDir);
    const html = readFileSync(outputPath, 'utf8');

    expect(outputPath).toBe(path.join(runDir, 'report.html'));
    expect(html).not.toContain('__DATA_PLACEHOLDER__');
    expect(html).toContain('#030712');
    expect(html).toContain('cw-freight-boolean-registry');
    expect(html).toContain('cw-freight-billing');
    expect(html).toContain('contains');
    expect(html).toContain('regex');
    expect(html).toContain('AgentV Evaluation Report');
    expect(html).not.toContain('<th>Progress</th>');
    expect(html).not.toContain('metric-stack');
    expect(html).toContain('<span class="pass-rate-track">');
    expect(html).toContain('<span class="pass-rate-label">${formatPercent(rate)}</span>');
    expect(html).toContain('Grader Results');
    expect(html).toContain('<th>Grader</th>');
    expect(html).not.toContain('Evaluator Results');
    expect(html).not.toContain('<th>Evaluator</th>');
  });

  it('emits an inline report script that parses successfully', async () => {
    const runDir = path.join(tempDir, 'run');
    await writeArtifactsFromResults([makeResult()], runDir, { evalFile: 'evals/demo.eval.yaml' });

    const { outputPath } = await writeResultsReport(runDir, undefined, tempDir);
    const html = readFileSync(outputPath, 'utf8');
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];

    expect(script).toBeString();

    const app = { innerHTML: '' };
    const headerMeta = { innerHTML: '' };
    const tabButton = {
      getAttribute: () => 'overview',
      classList: { toggle: () => undefined },
      addEventListener: () => undefined,
    };

    expect(() =>
      vm.runInNewContext(script!, {
        console,
        document: {
          getElementById(id: string) {
            if (id === 'app') return app;
            if (id === 'header-meta') return headerMeta;
            return null;
          },
          querySelectorAll(selector: string) {
            return selector === '.tab' ? [tabButton] : [];
          },
        },
      }),
    ).not.toThrow();
  });
});
