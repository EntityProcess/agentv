import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runIndexPath, writeArtifactsFromResults } from '../../src/evaluation/run-artifacts.js';
import { buildTraceFromMessages } from '../../src/evaluation/trace.js';
import type { EvaluationResult } from '../../src/evaluation/types.js';

describe('target execution artifacts', () => {
  it('indexes target execution envelopes, stdout/stderr, and transcripts', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'agentv-target-execution-'));
    try {
      const result: EvaluationResult = {
        timestamp: '2026-07-03T00:00:00.000Z',
        testId: 'crash-case',
        suite: 'runtime',
        score: 0,
        assertions: [{ text: 'target crashed', passed: false }],
        target: 'fake-cli',
        output: 'Error: target crashed',
        input: [{ role: 'user', content: 'run task' }],
        trace: buildTraceFromMessages({
          input: [{ role: 'user', content: 'run task' }],
          output: [{ role: 'assistant', content: 'partial answer' }],
          finalOutput: 'partial answer',
          target: 'fake-cli',
          testId: 'crash-case',
          error: 'target crashed',
        }),
        error: 'target crashed',
        executionStatus: 'execution_error',
        failureStage: 'agent',
        failureReasonCode: 'target_signal_crash',
        targetExecution: {
          schemaVersion: 'agentv.target_execution.v1',
          status: 'error',
          targetId: 'fake-cli',
          providerId: 'cli:fake-cli',
          providerKind: 'cli',
          runtimeMode: 'host',
          command: {
            argv: ['fake-agent', 'run'],
            commandLine: 'fake-agent run',
            cwd: '/workspace',
          },
          startedAt: '2026-07-03T00:00:00.000Z',
          endedAt: '2026-07-03T00:00:01.000Z',
          durationMs: 1000,
          exitCode: null,
          signal: 'SIGSEGV',
          errorKind: 'signal_crash',
          message: 'target crashed',
          logs: {
            stdout: {
              text: '{"event":"assistant_delta","text":"partial"}\n',
              truncated: false,
              bytes: 45,
              storedBytes: 45,
            },
            stderr: {
              text: 'segmentation fault\n',
              truncated: false,
              bytes: 19,
              storedBytes: 19,
            },
          },
          transcript: {
            messages: [{ role: 'assistant', content: 'partial answer' }],
            finalOutput: 'partial answer',
          },
        },
      };

      await writeArtifactsFromResults([result], outputDir, {
        evalFile: 'runtime.eval.yaml',
        runId: 'run-target-execution',
      });

      const indexContent = await readFile(runIndexPath(outputDir), 'utf8');
      const row = JSON.parse(indexContent.trim()) as Record<string, unknown>;
      expect(row.failure_reason_code).toBe('target_signal_crash');
      expect(row.target_execution_path).toBeTruthy();
      expect(row.stdout_path).toBeTruthy();
      expect(row.stderr_path).toBeTruthy();

      const targetExecution = row.target_execution as Record<string, unknown>;
      expect(targetExecution.error_kind).toBe('signal_crash');
      expect(targetExecution.provider_kind).toBe('cli');
      expect((targetExecution.artifacts as Record<string, unknown>).stdout_path).toBe(
        row.stdout_path,
      );
      expect(targetExecution.artifacts).toHaveProperty('transcript_path');

      const stdoutPath = path.join(outputDir, row.stdout_path as string);
      const stderrPath = path.join(outputDir, row.stderr_path as string);
      const envelopePath = path.join(outputDir, row.target_execution_path as string);

      await expect(readFile(stdoutPath, 'utf8')).resolves.toContain('assistant_delta');
      await expect(readFile(stderrPath, 'utf8')).resolves.toContain('segmentation fault');
      const envelope = JSON.parse(await readFile(envelopePath, 'utf8')) as Record<string, unknown>;
      expect(envelope.error_kind).toBe('signal_crash');
      expect(envelope.artifacts).toHaveProperty('stderr_path');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
