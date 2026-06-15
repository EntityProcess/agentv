import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type TranscriptEntry,
  TranscriptProvider,
  toTranscriptJsonLines,
} from '../../src/index.js';

describe('TranscriptProvider', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('groups per-message transcript rows into one replay entry per test', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-transcript-provider-'));
    tempDirs.push(dir);
    const transcriptPath = path.join(dir, 'transcript.jsonl');

    const transcript: TranscriptEntry = {
      messages: [
        { role: 'user', content: 'Inspect the repository' },
        {
          role: 'assistant',
          content: 'Opening the relevant files now.',
          toolCalls: [{ tool: 'read_file', input: { path: 'README.md' }, output: 'contents' }],
        },
      ],
      source: {
        provider: 'codex',
        sessionId: 'session-abc',
        startedAt: '2026-03-13T00:00:00.000Z',
        model: 'gpt-5.4',
      },
      tokenUsage: { input: 120, output: 45, cached: 12, reasoning: 6 },
      durationMs: 3200,
      costUsd: 0.0125,
    };

    const lines = toTranscriptJsonLines(transcript, {
      testId: 'case-1',
      target: 'offline-codex',
    });
    await writeFile(
      transcriptPath,
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
      'utf8',
    );

    const provider = await TranscriptProvider.fromFile(transcriptPath);
    expect(provider.lineCount).toBe(1);
    expect(provider.targetName).toBe('codex');

    const response = await provider.invoke({ question: 'ignored' });
    expect(response.output).toEqual(transcript.messages);
    expect(response.tokenUsage).toEqual({ input: 120, output: 45, cached: 12, reasoning: 6 });
    expect(response.durationMs).toBe(3200);
    expect(response.costUsd).toBe(0.0125);
    expect(response.startTime).toBe('2026-03-13T00:00:00.000Z');
  });

  it('counts distinct test transcripts instead of raw JSONL rows', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-transcript-provider-'));
    tempDirs.push(dir);
    const transcriptPath = path.join(dir, 'transcript.jsonl');

    const first = toTranscriptJsonLines({
      messages: [
        { role: 'user', content: 'First task' },
        { role: 'assistant', content: 'First answer' },
      ],
      source: { provider: 'claude', sessionId: 'one' },
    });
    const second = toTranscriptJsonLines({
      messages: [
        { role: 'user', content: 'Second task' },
        { role: 'assistant', content: 'Second answer' },
      ],
      source: { provider: 'claude', sessionId: 'two' },
    });

    await writeFile(
      transcriptPath,
      `${[...first, ...second].map((line) => JSON.stringify(line)).join('\n')}\n`,
      'utf8',
    );

    const provider = await TranscriptProvider.fromFile(transcriptPath);
    expect(provider.lineCount).toBe(2);
  });

  it('preserves opaque content, metadata, and tool payload keys', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-transcript-provider-'));
    tempDirs.push(dir);
    const transcriptPath = path.join(dir, 'transcript.jsonl');
    const content = [
      {
        type: 'image',
        media_type: 'image/png',
        providerCamelKey: 'content stays camelCase',
      },
    ];
    const metadata = {
      snake_value: 'metadata stays snake_case',
      providerCamelKey: 'metadata stays camelCase',
    };
    const input = {
      file_path: 'src/config.ts',
      providerCamelKey: 'input stays camelCase',
    };
    const output = {
      snake_value: 'output stays snake_case',
      providerCamelKey: 'output stays camelCase',
    };
    const transcript: TranscriptEntry = {
      messages: [
        {
          role: 'assistant',
          content: content as TranscriptEntry['messages'][number]['content'],
          metadata,
          toolCalls: [{ tool: 'Inspect', id: 'call-inspect', input, output }],
        },
      ],
      source: {
        provider: 'codex',
        sessionId: 'opaque-session',
      },
    };

    const lines = toTranscriptJsonLines(transcript, {
      testId: 'opaque-case',
      target: 'offline-codex',
    });
    await writeFile(
      transcriptPath,
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
      'utf8',
    );

    const row = lines[0] as unknown as {
      content: Array<Record<string, unknown>>;
      metadata: Record<string, unknown>;
      tool_calls: Array<{ input: Record<string, unknown>; output: Record<string, unknown> }>;
    };
    expect(row.content[0]).toMatchObject(content[0]);
    expect(row.metadata).toMatchObject(metadata);
    expect(row.tool_calls[0].input).toMatchObject(input);
    expect(row.tool_calls[0].output).toMatchObject(output);
    expect(row.content[0]).not.toHaveProperty('provider_camel_key');
    expect(row.metadata).not.toHaveProperty('snakeValue');

    const provider = await TranscriptProvider.fromFile(transcriptPath);
    const response = await provider.invoke({ question: 'ignored' });
    const message = response.output?.[0];
    expect(message?.content).toEqual(content);
    expect(message?.metadata).toEqual(metadata);
    expect(message?.toolCalls?.[0]?.input).toEqual(input);
    expect(message?.toolCalls?.[0]?.output).toEqual(output);
  });
});
