import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateRunDirectory } from '../../../src/commands/results/validate.js';

describe('results validate', () => {
  it('accepts v2 run-root result directories without layout warnings', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(tempDir, '.agentv', 'results', '2026-03-27T12-42-24-429Z');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          scores: [{ name: 'quality', type: 'llm', score: 1, pass: true, reason: 'passed' }],
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
          index_path: 'index.jsonl',
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
        'Directory is not under the canonical results tree. Expected: .agentv/results/<run_id>',
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
      const runDir = path.join(tempDir, '.agentv', 'results', '2026-03-27T12-42-24-429Z');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          scores: [{ name: 'quality', type: 'llm', score: 1, pass: true, reason: 'passed' }],
          execution_status: 'ok',
          summary_path: 'test-greeting/summary.json',
          trace_path: 'test-greeting/sample-1/trace.json',
          artifact_pointers: {
            trace: {
              ref: 'agentv/artifacts/v1',
              key: 'traces/test-greeting/sample-1/trace.json',
              path: 'test-greeting/sample-1/trace.json',
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

  it('rejects v2 metrics sidecars with trace or nested metrics fields', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(tempDir, '.agentv', 'results', '2026-03-27T12-42-24-429Z');
      const caseDir = path.join(runDir, 'test-greeting');
      mkdirSync(caseDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          scores: [{ name: 'quality', type: 'llm', score: 1, pass: true, reason: 'passed' }],
          execution_status: 'ok',
          summary_path: 'test-greeting/summary.json',
          metrics_path: 'test-greeting/metrics.json',
        })}\n`,
      );
      writeFileSync(path.join(caseDir, 'summary.json'), '{}\n');
      writeFileSync(path.join(runDir, 'summary.json'), '{}\n');
      writeFileSync(
        path.join(caseDir, 'metrics.json'),
        `${JSON.stringify({
          schema_version: 'agentv.metrics.v2',
          artifact_id: 'metrics-test-greeting',
          generated_at: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          target: 'gpt-4o',
          trace: { trace_id: 'trace-1' },
          source_artifacts: {},
          metrics: {},
        })}\n`,
      );

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics).toContainEqual({
        severity: 'error',
        message: 'test-greeting: metrics.json must not include trace in agentv.metrics.v2',
      });
      expect(diagnostics).toContainEqual({
        severity: 'error',
        message: 'test-greeting: metrics.json must not include nested metrics in agentv.metrics.v2',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('tolerates legacy nested metrics sidecars with warnings', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(tempDir, '.agentv', 'results', '2026-03-27T12-42-24-429Z');
      const caseDir = path.join(runDir, 'test-greeting');
      mkdirSync(caseDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          scores: [{ name: 'quality', type: 'llm', score: 1, pass: true, reason: 'passed' }],
          execution_status: 'ok',
          summary_path: 'test-greeting/summary.json',
          metrics_path: 'test-greeting/metrics.json',
        })}\n`,
      );
      writeFileSync(path.join(caseDir, 'summary.json'), '{}\n');
      writeFileSync(path.join(runDir, 'summary.json'), '{}\n');
      writeFileSync(
        path.join(caseDir, 'metrics.json'),
        `${JSON.stringify({
          schema_version: 'agentv.metrics.v1',
          artifact_id: 'metrics-test-greeting',
          generated_at: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          target: 'gpt-4o',
          trace: {
            schema_version: 'agentv.trace.v1',
            artifact_id: 'execution-trace-test-greeting',
            trace_id: 'trace-1',
            root_span_id: 'span-1',
          },
          source_artifacts: {},
          metrics: {
            tool_calls: {},
            tool_call_counts: {},
            tool_category_counts: {},
            total_tool_calls: 0,
            total_steps: 0,
            total_turns: 0,
            tool_call_events: [],
            shell_commands: [],
            files_read: [],
            files_modified: [],
            files_created: [],
            files_deleted: [],
            web_fetches: [],
            errors: [],
            errors_encountered: 0,
            output_chars: 0,
            transcript_chars: 0,
            reasoning_blocks: [],
            thinking_blocks: 0,
          },
        })}\n`,
      );

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(diagnostics).toContainEqual({
        severity: 'warning',
        message: 'test-greeting: metrics.json uses legacy trace identity; readers ignore it',
      });
      expect(diagnostics).toContainEqual({
        severity: 'warning',
        message: 'test-greeting: metrics.json uses legacy nested metrics; readers flatten it',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects legacy public grading fields', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(tempDir, '.agentv', 'results', '2026-03-27T12-42-24-429Z');
      mkdirSync(path.join(runDir, 'test-greeting'), { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${JSON.stringify({
          timestamp: '2026-03-27T12:42:24.429Z',
          test_id: 'test-greeting',
          score: 1,
          target: 'gpt-4o',
          execution_status: 'ok',
          summary_path: 'test-greeting/summary.json',
          grading_path: 'test-greeting/grading.json',
        })}\n`,
      );
      writeFileSync(path.join(runDir, 'test-greeting', 'summary.json'), '{}\n');
      writeFileSync(path.join(runDir, 'summary.json'), '{}\n');
      writeFileSync(
        path.join(runDir, 'test-greeting', 'grading.json'),
        `${JSON.stringify({
          score: 1,
          verdict: 'pass',
          assertions: [{ text: 'legacy assertion', passed: true }],
          summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
          metadata: {
            details: {
              checks: [{ text: 'legacy check', evidence: 'legacy evidence' }],
            },
          },
        })}\n`,
      );

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics).toContainEqual({
        severity: 'error',
        message: 'test-greeting: grading.json uses legacy field(s): assertions, verdict',
      });
      expect(diagnostics).toContainEqual({
        severity: 'error',
        message: 'test-greeting: grading.json must include pass, score, and reason',
      });
      expect(diagnostics).toContainEqual({
        severity: 'error',
        message: 'test-greeting: grading.json.metadata.details uses legacy field(s): checks',
      });
      expect(diagnostics).toContainEqual({
        severity: 'error',
        message:
          'test-greeting: grading.json.metadata.details.checks[0] uses legacy field(s): evidence',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('accepts new test_dir and legacy task_dir bundle metadata', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-validate-test-'));

    try {
      const runDir = path.join(
        tempDir,
        '.agentv',
        'results',
        'with-bundles',
        '2026-03-27T12-42-24-429Z',
      );
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        path.join(runDir, 'index.jsonl'),
        `${[
          JSON.stringify({
            timestamp: '2026-03-27T12:42:24.429Z',
            test_id: 'test-new',
            score: 1,
            target: 'gpt-4o',
            scores: [{ name: 'quality', type: 'llm', score: 1, pass: true, reason: 'passed' }],
            execution_status: 'ok',
            summary_path: 'test-new/summary.json',
            test_dir: 'test-new/test',
            eval_path: 'test-new/test/EVAL.yaml',
            providers_path: 'test-new/test/providers.yaml',
          }),
          JSON.stringify({
            timestamp: '2026-03-27T12:42:24.429Z',
            test_id: 'test-legacy',
            score: 1,
            target: 'gpt-4o',
            scores: [{ name: 'quality', type: 'llm', score: 1, pass: true, reason: 'passed' }],
            execution_status: 'ok',
            summary_path: 'test-legacy/summary.json',
            task_dir: 'test-legacy/task',
            eval_path: 'test-legacy/task/EVAL.yaml',
            providers_path: 'test-legacy/task/providers.yaml',
          }),
        ].join('\n')}\n`,
      );
      for (const testId of ['test-new', 'test-legacy']) {
        mkdirSync(path.join(runDir, testId), { recursive: true });
        writeFileSync(
          path.join(runDir, testId, 'summary.json'),
          `${JSON.stringify({
            test_id: testId,
            score: 1,
            target: 'gpt-4o',
            execution_status: 'ok',
          })}\n`,
        );
      }
      writeFileSync(path.join(runDir, 'summary.json'), '{}\n');

      const { diagnostics } = validateRunDirectory(runDir);

      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
