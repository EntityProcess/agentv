import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Message } from '../../src/evaluation/providers/types.js';
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

  it('preserves opaque payload keys while converting replay structure', async () => {
    const opaqueSource = {
      source_provider: 'codex',
      snake_value: 'source stays snake_case',
      providerCamelKey: 'source stays camelCase too',
    };
    const opaqueRedaction = {
      old_string: 'sensitive value',
      new_string: '[redacted]',
      providerCamelKey: 'redaction stays camelCase too',
    };
    const opaqueTranscript = [
      {
        event_type: 'tool_call',
        snake_value: 'transcript stays snake_case',
        providerCamelKey: 'transcript stays camelCase too',
      },
    ];
    const fixture = record({
      source: opaqueSource,
      redaction: opaqueRedaction,
      transcript: opaqueTranscript,
      output: [
        {
          role: 'assistant',
          content: [
            {
              type: 'image',
              media_type: 'image/png',
              image_url: 'https://example.test/screenshot.png',
              source: 'https://example.test/screenshot.png',
            },
          ] as unknown as Message['content'],
          metadata: {
            snake_value: 'metadata stays snake_case',
            media_type: 'application/json',
            image_url: 'https://example.test/metadata.png',
            providerCamelKey: 'metadata stays camelCase too',
          },
          toolCalls: [
            {
              tool: 'Edit',
              id: 'call-edit',
              input: {
                old_string: 'before',
                new_string: 'after',
                media_type: 'text/plain',
                image_url: 'https://example.test/input.png',
                providerCamelKey: 'input stays camelCase too',
              },
              output: {
                snake_value: 'tool output stays snake_case',
                media_type: 'application/json',
                image_url: 'https://example.test/output.png',
                providerCamelKey: 'output stays camelCase too',
              },
              durationMs: 44,
            },
          ],
          tokenUsage: { input: 2, output: 1 },
          durationMs: 45,
        },
      ],
    });

    const serialized = serializeReplayFixtureRecord(fixture);
    const row = JSON.parse(serialized) as Record<string, unknown>;
    const output = row.output as Array<Record<string, unknown>>;
    const message = output[0] ?? {};
    const content = message.content as Array<Record<string, unknown>>;
    const metadata = message.metadata as Record<string, unknown>;
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    const input = toolCalls[0]?.input as Record<string, unknown>;
    const toolOutput = toolCalls[0]?.output as Record<string, unknown>;

    expect(row.source).toMatchObject(opaqueSource);
    expect(row.redaction).toMatchObject(opaqueRedaction);
    expect(row.transcript).toEqual(opaqueTranscript);
    expect(message).toHaveProperty('tool_calls');
    expect(message).not.toHaveProperty('toolCalls');
    expect(message).toHaveProperty('token_usage');
    expect(message).not.toHaveProperty('tokenUsage');
    expect(toolCalls[0]).toHaveProperty('duration_ms', 44);
    expect(toolCalls[0]).not.toHaveProperty('durationMs');
    expect(content[0]).toMatchObject({
      media_type: 'image/png',
      image_url: 'https://example.test/screenshot.png',
    });
    expect(metadata).toMatchObject({
      snake_value: 'metadata stays snake_case',
      media_type: 'application/json',
      image_url: 'https://example.test/metadata.png',
      providerCamelKey: 'metadata stays camelCase too',
    });
    expect(input).toMatchObject({
      old_string: 'before',
      new_string: 'after',
      media_type: 'text/plain',
      image_url: 'https://example.test/input.png',
      providerCamelKey: 'input stays camelCase too',
    });
    expect(toolOutput).toMatchObject({
      snake_value: 'tool output stays snake_case',
      media_type: 'application/json',
      image_url: 'https://example.test/output.png',
      providerCamelKey: 'output stays camelCase too',
    });
    for (const payload of [content[0], metadata, input, toolOutput]) {
      expect(payload).not.toHaveProperty('mediaType');
      expect(payload).not.toHaveProperty('imageUrl');
      expect(payload).not.toHaveProperty('provider_camel_key');
    }
    expect(input).not.toHaveProperty('oldString');
    expect(input).not.toHaveProperty('newString');
    expect(toolOutput).not.toHaveProperty('snakeValue');
    for (const payload of [
      row.source as Record<string, unknown>,
      row.redaction as Record<string, unknown>,
      (row.transcript as Array<Record<string, unknown>>)[0],
    ]) {
      expect(payload).not.toHaveProperty('sourceProvider');
      expect(payload).not.toHaveProperty('eventType');
      expect(payload).not.toHaveProperty('provider_camel_key');
    }

    const dir = await mkdtemp(path.join(tmpdir(), 'agentv-replay-fixtures-'));
    try {
      const fixturePath = path.join(dir, 'payloads.jsonl');
      await writeFile(fixturePath, `${serialized}\n`, 'utf8');

      const records = await readReplayFixtureRecords(fixturePath);
      expect(records).toHaveLength(1);
      expect(records[0]?.source).toMatchObject(opaqueSource);
      expect(records[0]?.redaction).toMatchObject(opaqueRedaction);
      expect(records[0]?.transcript).toEqual(opaqueTranscript);
      const readMessage = records[0]?.output[0];
      const readContent = readMessage?.content as Array<Record<string, unknown>>;
      const readMetadata = readMessage?.metadata as Record<string, unknown>;
      const readToolCall = readMessage?.toolCalls?.[0];
      const readInput = readToolCall?.input as Record<string, unknown>;
      const readToolOutput = readToolCall?.output as Record<string, unknown>;

      expect(readMessage).toHaveProperty('toolCalls');
      expect(readMessage).not.toHaveProperty('tool_calls');
      expect(readMessage).toHaveProperty('tokenUsage');
      expect(readMessage).not.toHaveProperty('token_usage');
      expect(readToolCall).toHaveProperty('durationMs', 44);
      expect(readToolCall).not.toHaveProperty('duration_ms');
      expect(readContent[0]).toMatchObject({
        media_type: 'image/png',
        image_url: 'https://example.test/screenshot.png',
      });
      expect(readMetadata).toMatchObject(metadata);
      expect(readInput).toMatchObject(input);
      expect(readToolOutput).toMatchObject(toolOutput);
      for (const payload of [readContent[0], readMetadata, readInput, readToolOutput]) {
        expect(payload).not.toHaveProperty('mediaType');
        expect(payload).not.toHaveProperty('imageUrl');
        expect(payload).not.toHaveProperty('provider_camel_key');
      }
      expect(readInput).not.toHaveProperty('oldString');
      expect(readInput).not.toHaveProperty('newString');
      expect(readToolOutput).not.toHaveProperty('snakeValue');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
