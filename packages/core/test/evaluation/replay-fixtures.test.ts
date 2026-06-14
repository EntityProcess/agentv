import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { extractLastAssistantContent } from '../../src/evaluation/providers/types.js';
import {
  REPLAY_FIXTURE_SCHEMA_VERSION,
  type ReplayFixtureRecord,
  findReplayFixtureRecord,
  readReplayFixtureRecords,
  replayFixtureRecordToProviderResponse,
  serializeReplayFixtureRecord,
} from '../../src/evaluation/replay-fixtures.js';

function record(overrides: Partial<ReplayFixtureRecord> = {}): ReplayFixtureRecord {
  return {
    schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
    suite: 'suite-a',
    evalPath: 'evals/sample.eval.yaml',
    testId: 'case-a',
    sourceTarget: 'live-agent',
    attempt: 0,
    fixtureId: 'fixture-a',
    recordedAt: '2026-06-01T00:00:00.000Z',
    source: { provider: 'codex', model: 'gpt-5' },
    output: [
      {
        role: 'assistant',
        content: 'Recorded answer',
        toolCalls: [
          {
            tool: 'Read',
            id: 'call-read',
            input: { path: 'src/config.ts' },
            output: { content: 'timeoutMs = 0' },
            durationMs: 12,
          },
        ],
      },
    ],
    transcript: [{ event: 'message' }],
    tokenUsage: { input: 10, output: 3, cached: 2 },
    costUsd: 0.0042,
    durationMs: 123,
    ...overrides,
  };
}

describe('replay fixtures', () => {
  it('parses strict snake_case JSONL and resolves shuffled records by identity', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-replay-fixtures-'));
    try {
      const fixturePath = path.join(dir, 'replay.jsonl');
      const wanted = record({ testId: 'wanted', attempt: 1, variant: 'legal-v1' });
      const other = record({ testId: 'other', fixtureId: 'fixture-other' });
      await writeFile(
        fixturePath,
        `${serializeReplayFixtureRecord(other)}\n${serializeReplayFixtureRecord(wanted)}\n`,
        'utf8',
      );

      const records = await readReplayFixtureRecords(fixturePath);
      const match = findReplayFixtureRecord(records, {
        suite: 'suite-a',
        evalPath: path.join(dir, 'project', 'evals/sample.eval.yaml'),
        testId: 'wanted',
        sourceTarget: 'live-agent',
        attempt: 1,
        variant: 'legal-v1',
      });
      const response = replayFixtureRecordToProviderResponse(match);

      expect(extractLastAssistantContent(response.output)).toBe('Recorded answer');
      expect(response.output?.[0]?.toolCalls?.[0]?.durationMs).toBe(12);
      expect(response.tokenUsage).toEqual({ input: 10, output: 3, cached: 2 });
      expect(response.costUsd).toBe(0.0042);
      expect(response.durationMs).toBe(123);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly for missing and duplicate fixture records', async () => {
    const duplicate = [record({ fixtureId: 'dup-a' }), record({ fixtureId: 'dup-b' })];

    expect(() =>
      findReplayFixtureRecord(duplicate, {
        suite: 'suite-a',
        evalPath: 'evals/sample.eval.yaml',
        testId: 'case-a',
        sourceTarget: 'live-agent',
      }),
    ).toThrow(/duplicate records/i);

    expect(() =>
      findReplayFixtureRecord([record()], {
        suite: 'suite-a',
        testId: 'missing',
        sourceTarget: 'live-agent',
      }),
    ).toThrow(/no record/i);
  });

  it('rejects non-snake_case fixture rows at the wire boundary', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-replay-fixtures-'));
    try {
      const fixturePath = path.join(dir, 'bad.jsonl');
      await writeFile(
        fixturePath,
        `${JSON.stringify({
          schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
          suite: 'suite-a',
          testId: 'case-a',
          sourceTarget: 'live-agent',
          output: [],
        })}\n`,
        'utf8',
      );

      await expect(readReplayFixtureRecords(fixturePath)).rejects.toThrow(/schema_version/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects non-snake_case output message keys', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-replay-fixtures-'));
    try {
      const fixturePath = path.join(dir, 'bad-output.jsonl');
      await writeFile(
        fixturePath,
        `${JSON.stringify({
          schema_version: REPLAY_FIXTURE_SCHEMA_VERSION,
          suite: 'suite-a',
          test_id: 'case-a',
          source_target: 'live-agent',
          output: [
            {
              role: 'assistant',
              content: 'bad',
              toolCalls: [{ tool: 'Read', durationMs: 12 }],
            },
          ],
        })}\n`,
        'utf8',
      );

      await expect(readReplayFixtureRecords(fixturePath)).rejects.toThrow(/toolCalls/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
