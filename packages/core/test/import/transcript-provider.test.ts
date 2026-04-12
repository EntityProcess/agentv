import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TranscriptProvider, toTranscriptJsonLines, type TranscriptEntry } from '../../src/index.js';

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
    await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

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
});
