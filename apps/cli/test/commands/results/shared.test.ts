import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildTraceEnvelopeFromEvaluationResult,
  buildTraceFromMessages,
  toTraceEnvelopeWire,
} from '@agentv/core';

import { resolveRunManifestPath } from '../../../src/commands/eval/result-layout.js';
import { loadManifestResults } from '../../../src/commands/results/manifest.js';
import { resolveSourceFile } from '../../../src/commands/results/shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('results shared source resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'agentv-results-shared-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves an explicit legacy run workspace directory to index.jsonl', async () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, 'index.jsonl'), '{"test_id":"t1","score":1}\n');

    const resolved = await resolveSourceFile(runDir, tempDir);

    expect(resolved.sourceFile).toBe(path.join(runDir, 'index.jsonl'));
  });

  it('auto-discovers the most recent direct run workspace', async () => {
    const olderRunDir = path.join(tempDir, '.agentv', 'results', '2026-03-24T10-00-00-000Z');
    const newerRunDir = path.join(tempDir, '.agentv', 'results', '2026-03-25T10-00-00-000Z');
    mkdirSync(olderRunDir, { recursive: true });
    mkdirSync(newerRunDir, { recursive: true });
    writeFileSync(path.join(olderRunDir, 'index.jsonl'), '{"test_id":"old","score":1}\n');
    writeFileSync(path.join(newerRunDir, 'index.jsonl'), '{"test_id":"new","score":1}\n');

    const resolved = await resolveSourceFile(undefined, tempDir);

    expect(resolved.sourceFile).toBe(path.join(newerRunDir, 'index.jsonl'));
  });

  it('rejects legacy flat result files as result sources', () => {
    const flatFile = path.join(tempDir, 'results.jsonl');
    writeFileSync(flatFile, '{"test_id":"t1","score":1}\n');

    expect(() => resolveRunManifestPath(flatFile)).toThrow(
      'Expected a run workspace directory or index.jsonl manifest',
    );
  });

  it('normalizes historical camelCase replay rows when loading manifests', () => {
    const fixturePath = path.join(__dirname, '../../fixtures/results/camel-replay/index.jsonl');

    const results = loadManifestResults(fixturePath);

    expect(results).toHaveLength(1);
    expect(results[0].testId).toBe('wtg-replay-fail');
    expect(results[0].executionStatus).toBe('quality_failure');
    expect(results[0].durationMs).toBe(1234);
    expect(results[0].tokenUsage).toEqual({ input: 10, output: 5 });
    expect(results[0].costUsd).toBe(0.012);
    expect(results[0].trace.toolCalls).toEqual({ rg: 1 });
  });

  it('ignores legacy transcript artifact pointers when hydrating traces', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    const transcriptRelativePath = 'pointer-case/transcript.jsonl';
    mkdirSync(path.join(runDir, 'pointer-case'), { recursive: true });
    writeFileSync(
      path.join(runDir, transcriptRelativePath),
      `${JSON.stringify({
        schema_version: 'agentv.transcript.v1',
        test_id: 'pointer-case',
        target: 'codex',
        message_index: 0,
        role: 'assistant',
        content: 'Loaded from pointer',
        source: { provider: 'codex', session_id: 'session-pointer' },
      })}\n`,
    );
    writeFileSync(path.join(runDir, 'pointer-case/answer.md'), 'Loaded from output\n');
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(
      indexPath,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:00.000Z',
        test_id: 'pointer-case',
        target: 'codex',
        score: 1,
        grading_path: 'pointer-case/grading.json',
        timing_path: 'pointer-case/timing.json',
        answer_path: 'pointer-case/answer.md',
        artifact_pointers: {
          transcript: {
            ref: 'agentv/artifacts/v1',
            key: 'transcripts/pointer-case/transcript.jsonl',
            object_version: 'sha256:test',
            path: transcriptRelativePath,
            sha256: 'test',
            size: 1,
            schema_version: 'agentv.transcript.v1',
            media_type: 'application/x-ndjson',
            family: 'transcripts',
          },
        },
      })}\n`,
    );

    const results = loadManifestResults(indexPath);

    expect(results).toHaveLength(1);
    expect(results[0].trace.messages[0]?.content).toBe('Loaded from output');
    expect(results[0].trace.messages[0]?.role).toBe('assistant');
    expect(results[0].trace.toolCalls).toEqual({});
  });

  it('hydrates trace evidence from trace_path when transcript_path is normalized', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    mkdirSync(path.join(runDir, 'trace-case'), { recursive: true });
    const trace = buildTraceFromMessages({
      output: [
        {
          role: 'assistant',
          content: 'Loaded from trace artifact',
          toolCalls: [
            {
              tool: 'shell',
              id: 'tool-1',
              input: { cmd: 'pwd' },
              output: '/repo',
              status: 'ok',
            },
          ],
        },
      ],
      finalOutput: 'Loaded from trace artifact',
      target: 'codex',
      testId: 'trace-case',
    });
    const envelope = buildTraceEnvelopeFromEvaluationResult(
      {
        timestamp: '2026-03-25T10:00:00.000Z',
        testId: 'trace-case',
        target: 'codex',
        score: 1,
        assertions: [],
        output: 'Loaded from trace artifact',
        trace,
      },
      {
        capture: { content: 'full', redactionLevel: 'none' },
        now: () => new Date('2026-03-25T10:00:00.000Z'),
      },
    );
    writeFileSync(
      path.join(runDir, 'trace-case/trace.json'),
      `${JSON.stringify(toTraceEnvelopeWire(envelope))}\n`,
    );
    writeFileSync(
      path.join(runDir, 'trace-case/transcript.jsonl'),
      `${JSON.stringify({
        v: 1,
        agent: 'codex',
        type: 'assistant',
        content: [{ type: 'text', text: 'Loaded from normalized transcript' }],
      })}\n`,
    );
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(
      indexPath,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:00.000Z',
        test_id: 'trace-case',
        target: 'codex',
        score: 1,
        trace_path: 'trace-case/trace.json',
        transcript_path: 'trace-case/transcript.jsonl',
      })}\n`,
    );

    const results = loadManifestResults(indexPath);

    expect(results).toHaveLength(1);
    expect(results[0].trace.messages[0]?.content).toBe('Loaded from trace artifact');
    expect(results[0].trace.toolCalls).toEqual({ shell: 1 });
  });

  it('does not hydrate trace evidence from transcript_raw_path', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    mkdirSync(path.join(runDir, 'raw-case'), { recursive: true });
    writeFileSync(
      path.join(runDir, 'raw-case/transcript.jsonl'),
      `${JSON.stringify({
        v: 1,
        agent: 'codex',
        type: 'assistant',
        content: [{ type: 'text', text: 'Loaded from normalized transcript' }],
      })}\n`,
    );
    writeFileSync(
      path.join(runDir, 'raw-case/transcript-raw.jsonl'),
      `${JSON.stringify({
        schema_version: 'agentv.transcript.v1',
        test_id: 'raw-case',
        target: 'codex',
        message_index: 0,
        role: 'assistant',
        content: 'Loaded from raw transcript',
        tool_calls: [
          {
            tool: 'shell',
            id: 'tool-1',
            input: { cmd: 'pwd' },
            output: '/repo',
            status: 'ok',
          },
        ],
        source: { provider: 'codex', session_id: 'session-raw' },
      })}\n`,
    );
    writeFileSync(path.join(runDir, 'raw-case/answer.md'), 'Loaded from output fallback\n');
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(
      indexPath,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:00.000Z',
        test_id: 'raw-case',
        target: 'codex',
        score: 1,
        transcript_path: 'raw-case/transcript.jsonl',
        transcript_raw_path: 'raw-case/transcript-raw.jsonl',
        answer_path: 'raw-case/answer.md',
      })}\n`,
    );

    const results = loadManifestResults(indexPath);

    expect(results).toHaveLength(1);
    expect(results[0].trace.messages[0]?.content).toBe('Loaded from output fallback');
    expect(results[0].trace.toolCalls).toEqual({});
  });

  it('falls back to a minimal trace when only normalized transcript_path is present', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    mkdirSync(path.join(runDir, 'normalized-only'), { recursive: true });
    writeFileSync(
      path.join(runDir, 'normalized-only/transcript.jsonl'),
      `${JSON.stringify({
        v: 1,
        agent: 'codex',
        type: 'assistant',
        content: [{ type: 'text', text: 'Normalized transcript text' }],
      })}\n`,
    );
    writeFileSync(path.join(runDir, 'normalized-only/answer.md'), 'Fallback answer\n');
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(
      indexPath,
      `${JSON.stringify({
        timestamp: '2026-03-25T10:00:00.000Z',
        test_id: 'normalized-only',
        target: 'codex',
        score: 1,
        transcript_path: 'normalized-only/transcript.jsonl',
        answer_path: 'normalized-only/answer.md',
      })}\n`,
    );

    const results = loadManifestResults(indexPath);

    expect(results).toHaveLength(1);
    expect(results[0].trace.messages[0]?.content).toBe('Fallback answer');
    expect(results[0].trace.toolCalls).toEqual({});
  });

  it('rejects eval-case-only rows with migration guidance', () => {
    const runDir = path.join(tempDir, '.agentv', 'results', 'default', '2026-03-25T10-00-00-000Z');
    mkdirSync(runDir, { recursive: true });
    const indexPath = path.join(runDir, 'index.jsonl');
    writeFileSync(indexPath, '{"id":"case-a","prompt":"What is 2 + 2?"}\n');

    expect(() => loadManifestResults(indexPath)).toThrow(/Eval-case JSONL is input data/);
  });
});
