import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateRunDirectory } from '../../../src/commands/results/validate.js';

describe('results validate', () => {
  it('accepts experiment-scoped result directories without layout warnings', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(
        tempDir,
        '.agentv',
        'results',
        'with-skills',
        '2026-03-27T12-42-24-429Z',
      );
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          scores: [{ name: 'quality', type: 'llm', score: 1, verdict: 'pass' }],
          execution_status: 'ok',
          summary_path: 'test-greeting/summary.json',
        })}\n`,
      );
      mkdirSync(path.join(runDir, 'test-greeting'), { recursive: true });
      writeFileSync(
        path.join(runDir, 'test-greeting', 'summary.json'),
        `${JSON.stringify({
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          execution_status: 'ok',
        })}\n`,
      );
      writeFileSync(
        path.join(runDir, 'summary.json'),
        `${JSON.stringify({
          manifest_path: 'index.jsonl',
          schema_version: 1,
          metadata: {
            experiment: 'with-skills',
            timestamp: '2026-03-27T12:42:24.429Z',
          },
        })}\n`,
      );

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(diagnostics.map((d) => d.message)).not.toContain(
        'Directory is not under the canonical results tree. Expected: .agentv/results/<experiment>/<timestamp>',
      );
      expect(
        diagnostics.some((d) => d.message.includes('does not match the expected pattern')),
      ).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects public trace artifact fields in index.jsonl', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(
        tempDir,
        '.agentv',
        'results',
        'with-skills',
        '2026-03-27T12-42-24-429Z',
      );
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          scores: [{ name: 'quality', type: 'llm', score: 1, verdict: 'pass' }],
          execution_status: 'ok',
          summary_path: 'test-greeting/summary.json',
          trace_path: 'test-greeting/run-1/trace.json',
          artifact_pointers: {
            trace: {
              ref: 'agentv/artifacts/v1',
              key: 'traces/test-greeting/run-1/trace.json',
              path: 'test-greeting/run-1/trace.json',
            },
          },
        })}\n`,
      );
      mkdirSync(path.join(runDir, 'test-greeting'), { recursive: true });
      writeFileSync(path.join(runDir, 'test-greeting', 'summary.json'), '{}\n');
      writeFileSync(path.join(runDir, 'summary.json'), '{}\n');

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics).toContainEqual({
        severity: 'error',
        message:
          'index.jsonl line 1 (test-greeting): trace_path is no longer supported; use transcript_path and metrics_path',
      });
      expect(diagnostics).toContainEqual({
        severity: 'error',
        message:
          'index.jsonl line 1 (test-greeting): artifact_pointers.trace is no longer supported',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
