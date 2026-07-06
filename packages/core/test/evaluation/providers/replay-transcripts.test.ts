import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ReplayProvider, type TranscriptEntry, toTranscriptJsonLines } from '../../../src/index.js';

describe('ReplayProvider transcript source', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('replays normalized transcript JSONL by test_id and source_target', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-replay-transcript-'));
    tempDirs.push(dir);
    const transcriptPath = path.join(dir, 'transcript.jsonl');
    const transcript: TranscriptEntry = {
      messages: [
        { role: 'user', content: 'Inspect the repo' },
        {
          role: 'assistant',
          content: 'I inspected it.',
          toolCalls: [
            {
              tool: 'Read',
              input: { path: '.agents/skills/csv-analyzer/SKILL.md' },
              output: 'skill instructions',
            },
          ],
        },
      ],
      source: {
        kind: 'imported_transcript',
        provider: 'copilot',
        sessionId: 'copilot-session-1',
        model: 'gpt-5-mini',
      },
      tokenUsage: { input: 10, output: 5 },
      durationMs: 1234,
    };
    const rows = toTranscriptJsonLines(transcript, {
      testId: 'copilot-case',
      target: 'copilot-cli',
    });
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const provider = new ReplayProvider('copilot-cassette', {
      source: { kind: 'transcripts', path: transcriptPath },
      sourceTarget: 'copilot-cli',
    });
    const response = await provider.invoke({
      question: 'ignored',
      evalCaseId: 'copilot-case',
    });

    expect(response.output).toEqual(transcript.messages);
    expect(response.tokenUsage).toEqual({ input: 10, output: 5 });
    expect(response.durationMs).toBe(1234);
    expect(response.metadata?.skillCalls).toEqual([
      {
        name: 'csv-analyzer',
        input: { path: '.agents/skills/csv-analyzer/SKILL.md' },
        path: '.agents/skills/csv-analyzer/SKILL.md',
        source: 'heuristic',
      },
    ]);
    expect(response.raw?.replay_transcript).toMatchObject({
      test_id: 'copilot-case',
      target: 'copilot-cli',
      source_provider: 'copilot',
      source_session_id: 'copilot-session-1',
    });
  });

  it('does not replay a transcript for the wrong test_id', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-replay-transcript-'));
    tempDirs.push(dir);
    const transcriptPath = path.join(dir, 'transcript.jsonl');
    const rows = toTranscriptJsonLines(
      {
        messages: [{ role: 'assistant', content: 'Recorded answer' }],
        source: { provider: 'copilot', sessionId: 'copilot-session-1' },
      },
      { testId: 'recorded-case', target: 'copilot-cli' },
    );
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const provider = new ReplayProvider('copilot-cassette', {
      source: { kind: 'transcripts', path: transcriptPath },
      sourceTarget: 'copilot-cli',
    });

    await expect(
      provider.invoke({ question: 'ignored', evalCaseId: 'different-case' }),
    ).rejects.toThrow(/Transcript replay lookup found no record for test_id=different-case/);
  });

  it('matches source_target when one transcript file has the same test_id for multiple targets', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-replay-transcript-'));
    tempDirs.push(dir);
    const transcriptPath = path.join(dir, 'transcript.jsonl');
    const rows = [
      ...toTranscriptJsonLines(
        {
          messages: [{ role: 'assistant', content: 'Copilot answer' }],
          source: { provider: 'copilot', sessionId: 'copilot-session-1' },
        },
        { testId: 'shared-case', target: 'copilot-cli' },
      ),
      ...toTranscriptJsonLines(
        {
          messages: [{ role: 'assistant', content: 'Claude answer' }],
          source: { provider: 'claude', sessionId: 'claude-session-1' },
        },
        { testId: 'shared-case', target: 'claude-cli' },
      ),
    ];
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const provider = new ReplayProvider('claude-cassette', {
      source: { kind: 'transcripts', path: transcriptPath },
      sourceTarget: 'claude-cli',
    });
    const response = await provider.invoke({
      question: 'ignored',
      evalCaseId: 'shared-case',
    });

    expect(response.output?.[0]?.content).toBe('Claude answer');
  });
});
