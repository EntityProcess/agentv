import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OutputMessage } from '@agentv/core';
import {
  TraceWriter,
  buildTraceRecord,
  extractTraceSpans,
} from '../../../src/commands/eval/trace-writer.js';

describe('TraceWriter', () => {
  const testDir = path.join(import.meta.dir, '.test-traces');
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(testDir, `trace-${Date.now()}.jsonl`);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('open', () => {
    it('should create directory and file', async () => {
      const writer = await TraceWriter.open(testFilePath);

      // Verify directory was created
      const dirStat = await stat(path.dirname(testFilePath));
      expect(dirStat.isDirectory()).toBe(true);

      await writer.close();
    });

    it('should create nested directories', async () => {
      const nestedPath = path.join(testDir, 'nested', 'deep', 'trace.jsonl');
      const writer = await TraceWriter.open(nestedPath);

      const dirStat = await stat(path.dirname(nestedPath));
      expect(dirStat.isDirectory()).toBe(true);

      await writer.close();
    });
  });

  describe('append', () => {
    it('should write a single trace record as JSONL', async () => {
      const writer = await TraceWriter.open(testFilePath);

      const record = {
        testId: 'test-1',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:01:00Z',
        durationMs: 60000,
        spans: [
          {
            type: 'tool' as const,
            name: 'read_file',
            startTime: '2024-01-01T00:00:10Z',
            durationMs: 100,
            input: { path: '/test/file.txt' },
            output: { content: 'test content' },
          },
        ],
        tokenUsage: { input: 100, output: 50 },
        costUsd: 0.01,
      };

      await writer.append(record);
      await writer.close();

      const content = await readFile(testFilePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.test_id).toBe('test-1');
      expect(parsed.start_time).toBe('2024-01-01T00:00:00Z');
      expect(parsed.duration_ms).toBe(60000);
      expect(parsed.spans).toHaveLength(1);
      expect(parsed.spans[0].type).toBe('tool');
      expect(parsed.spans[0].name).toBe('read_file');
      expect(parsed.token_usage.input).toBe(100);
      expect(parsed.cost_usd).toBe(0.01);
    });

    it('should write multiple trace records', async () => {
      const writer = await TraceWriter.open(testFilePath);

      await writer.append({ testId: 'test-1', spans: [] });
      await writer.append({ testId: 'test-2', spans: [] });
      await writer.append({ testId: 'test-3', spans: [] });

      await writer.close();

      const content = await readFile(testFilePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(3);

      expect(JSON.parse(lines[0]).test_id).toBe('test-1');
      expect(JSON.parse(lines[1]).test_id).toBe('test-2');
      expect(JSON.parse(lines[2]).test_id).toBe('test-3');
    });

    it('should throw when writing to closed writer', async () => {
      const writer = await TraceWriter.open(testFilePath);
      await writer.close();

      await expect(writer.append({ testId: 'test', spans: [] })).rejects.toThrow(
        'Cannot write to closed trace writer',
      );
    });
  });

  describe('close', () => {
    it('should be idempotent', async () => {
      const writer = await TraceWriter.open(testFilePath);

      await writer.close();
      await writer.close(); // Should not throw
      await writer.close(); // Should not throw
    });
  });

  describe('concurrent writes', () => {
    it('should handle concurrent writes safely', async () => {
      const writer = await TraceWriter.open(testFilePath);

      // Write 100 records concurrently
      const writePromises = Array.from({ length: 100 }, (_, i) =>
        writer.append({ testId: `test-${i}`, spans: [] }),
      );

      await Promise.all(writePromises);
      await writer.close();

      const content = await readFile(testFilePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(100);

      // Verify all records are valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.test_id).toMatch(/^test-\d+$/);
      }
    });
  });
});

describe('extractTraceSpans', () => {
  it('should extract tool calls from output messages', () => {
    const messages: OutputMessage[] = [
      {
        role: 'assistant',
        content: 'Let me help you',
        toolCalls: [
          {
            tool: 'read_file',
            input: { path: '/test/file.txt' },
            output: { content: 'file content' },
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:00:01Z',
            durationMs: 1000,
          },
          {
            tool: 'write_file',
            input: { path: '/test/output.txt', content: 'new content' },
            output: { success: true },
            durationMs: 500,
          },
        ],
      },
    ];

    const spans = extractTraceSpans(messages);

    expect(spans).toHaveLength(2);
    expect(spans[0].type).toBe('tool');
    expect(spans[0].name).toBe('read_file');
    expect(spans[0].startTime).toBe('2024-01-01T00:00:00Z');
    expect(spans[0].durationMs).toBe(1000);
    expect(spans[0].input).toEqual({ path: '/test/file.txt' });
    expect(spans[0].output).toEqual({ content: 'file content' });

    expect(spans[1].name).toBe('write_file');
    expect(spans[1].durationMs).toBe(500);
  });

  it('should handle messages without tool calls', () => {
    const messages: OutputMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];

    const spans = extractTraceSpans(messages);
    expect(spans).toHaveLength(0);
  });

  it('should handle multiple messages with tool calls', () => {
    const messages: OutputMessage[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'tool1', input: {} }],
      },
      {
        role: 'assistant',
        toolCalls: [
          { tool: 'tool2', input: {} },
          { tool: 'tool3', input: {} },
        ],
      },
    ];

    const spans = extractTraceSpans(messages);
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.name)).toEqual(['tool1', 'tool2', 'tool3']);
  });

  it('should handle empty messages array', () => {
    const spans = extractTraceSpans([]);
    expect(spans).toHaveLength(0);
  });
});

describe('buildTraceRecord', () => {
  it('should build a complete trace record', () => {
    const messages: OutputMessage[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'read_file', input: { path: '/test' } }],
      },
    ];

    const record = buildTraceRecord('eval-123', messages, {
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-01T00:01:00Z',
      durationMs: 60000,
      tokenUsage: { input: 100, output: 50 },
      costUsd: 0.01,
    });

    expect(record.testId).toBe('eval-123');
    expect(record.startTime).toBe('2024-01-01T00:00:00Z');
    expect(record.endTime).toBe('2024-01-01T00:01:00Z');
    expect(record.durationMs).toBe(60000);
    expect(record.spans).toHaveLength(1);
    expect(record.spans[0].name).toBe('read_file');
    expect(record.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(record.costUsd).toBe(0.01);
  });

  it('should build a minimal trace record', () => {
    const record = buildTraceRecord('eval-456', []);

    expect(record.testId).toBe('eval-456');
    expect(record.spans).toHaveLength(0);
    expect(record.startTime).toBeUndefined();
    expect(record.tokenUsage).toBeUndefined();
    expect(record.costUsd).toBeUndefined();
  });
});
