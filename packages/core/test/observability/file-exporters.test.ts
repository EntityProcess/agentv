import { afterEach, describe, expect, it } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { OtlpJsonFileExporter } from '../../src/observability/otlp-json-file-exporter.js';
import { SimpleTraceFileExporter } from '../../src/observability/simple-trace-file-exporter.js';

const testDir = path.join(import.meta.dir, '.test-file-exporters');

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Mock span helpers
// ---------------------------------------------------------------------------

function makeSpan(overrides: {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  startTime?: [number, number];
  endTime?: [number, number];
  attributes?: Record<string, unknown>;
  status?: { code: number };
  events?: Array<{ name: string; time: [number, number]; attributes?: Record<string, unknown> }>;
}) {
  const traceId = overrides.traceId ?? 'abc123';
  const spanId = overrides.spanId ?? 'span1';
  return {
    spanContext: () => ({ traceId, spanId }),
    parentSpanId: overrides.parentSpanId,
    name: overrides.name ?? 'test-span',
    kind: overrides.kind ?? 0,
    startTime: overrides.startTime ?? [1000, 0],
    endTime: overrides.endTime ?? [1001, 0],
    attributes: overrides.attributes ?? {},
    status: overrides.status ?? { code: 0 },
    events: overrides.events ?? [],
  };
}

// ---------------------------------------------------------------------------
// OtlpJsonFileExporter
// ---------------------------------------------------------------------------

describe('OtlpJsonFileExporter', () => {
  it('writes OTLP JSON with resourceSpans structure', async () => {
    const filePath = path.join(testDir, 'otlp', 'trace.json');
    const exporter = new OtlpJsonFileExporter(filePath);

    const span = makeSpan({
      name: 'agentv.eval',
      attributes: { 'agentv.test_id': 'test-1', 'agentv.score': 0.9 },
      events: [
        {
          name: 'agentv.evaluator.match',
          time: [1000, 500_000_000],
          attributes: { 'agentv.evaluator.score': 1 },
        },
      ],
    });

    exporter.export([span], (result) => {
      expect(result.code).toBe(0);
    });

    await exporter.shutdown();

    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);

    expect(parsed.resourceSpans).toHaveLength(1);
    expect(parsed.resourceSpans[0].scopeSpans).toHaveLength(1);
    expect(parsed.resourceSpans[0].scopeSpans[0].scope.name).toBe('agentv');

    const spans = parsed.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('agentv.eval');
    expect(spans[0].traceId).toBe('abc123');
    expect(spans[0].spanId).toBe('span1');
    expect(spans[0].startTimeUnixNano).toBe('1000000000000');
    expect(spans[0].endTimeUnixNano).toBe('1001000000000');

    // Check attributes serialization
    const testIdAttr = spans[0].attributes.find((a: { key: string }) => a.key === 'agentv.test_id');
    expect(testIdAttr.value).toEqual({ stringValue: 'test-1' });

    const scoreAttr = spans[0].attributes.find((a: { key: string }) => a.key === 'agentv.score');
    expect(scoreAttr.value).toEqual({ doubleValue: 0.9 });

    // Check events
    expect(spans[0].events).toHaveLength(1);
    expect(spans[0].events[0].name).toBe('agentv.evaluator.match');
  });

  it('collects spans across multiple export calls', async () => {
    const filePath = path.join(testDir, 'otlp', 'multi.json');
    const exporter = new OtlpJsonFileExporter(filePath);

    exporter.export([makeSpan({ spanId: 's1', name: 'span-1' })], (r) => expect(r.code).toBe(0));
    exporter.export([makeSpan({ spanId: 's2', name: 'span-2' })], (r) => expect(r.code).toBe(0));

    await exporter.shutdown();

    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    const spans = parsed.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe('span-1');
    expect(spans[1].name).toBe('span-2');
  });

  it('no-ops when no spans were exported', async () => {
    const filePath = path.join(testDir, 'otlp', 'empty.json');
    const exporter = new OtlpJsonFileExporter(filePath);
    await exporter.shutdown();

    // File should not be created
    await expect(readFile(filePath, 'utf8')).rejects.toThrow();
  });

  it('serializes attribute types correctly', async () => {
    const filePath = path.join(testDir, 'otlp', 'attrs.json');
    const exporter = new OtlpJsonFileExporter(filePath);

    exporter.export(
      [
        makeSpan({
          attributes: {
            str: 'hello',
            int: 42,
            float: 3.14,
            bool: true,
            arr: ['a', 'b'],
          },
        }),
      ],
      () => {},
    );

    await exporter.shutdown();

    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    const attrs = parsed.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    const byKey = Object.fromEntries(
      attrs.map((a: { key: string; value: unknown }) => [a.key, a.value]),
    );

    expect(byKey.str).toEqual({ stringValue: 'hello' });
    expect(byKey.int).toEqual({ intValue: 42 });
    expect(byKey.float).toEqual({ doubleValue: 3.14 });
    expect(byKey.bool).toEqual({ boolValue: true });
    expect(byKey.arr).toEqual({
      arrayValue: {
        values: [{ stringValue: 'a' }, { stringValue: 'b' }],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// SimpleTraceFileExporter
// ---------------------------------------------------------------------------

describe('SimpleTraceFileExporter', () => {
  it('writes a JSONL line per root span', async () => {
    const filePath = path.join(testDir, 'simple', 'trace.jsonl');
    const exporter = new SimpleTraceFileExporter(filePath);

    const root = makeSpan({
      spanId: 'root1',
      name: 'agentv.eval',
      startTime: [1000, 0],
      endTime: [1002, 500_000_000],
      attributes: {
        'agentv.test_id': 'test-1',
        'agentv.target': 'my-agent',
        'agentv.score': 0.85,
        'agentv.trace.cost_usd': 0.003,
      },
    });

    exporter.export([root], (r) => expect(r.code).toBe(0));
    await exporter.shutdown();

    const content = await readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]);
    expect(record.test_id).toBe('test-1');
    expect(record.target).toBe('my-agent');
    expect(record.score).toBe(0.85);
    expect(record.duration_ms).toBe(2500);
    expect(record.cost_usd).toBe(0.003);
  });

  it('aggregates token usage from child spans', async () => {
    const filePath = path.join(testDir, 'simple', 'tokens.jsonl');
    const exporter = new SimpleTraceFileExporter(filePath);

    const root = makeSpan({
      spanId: 'root1',
      name: 'agentv.eval',
      attributes: { 'agentv.test_id': 'test-tokens' },
    });

    const child1 = makeSpan({
      spanId: 'child1',
      parentSpanId: 'root1',
      name: 'chat gpt-4',
      attributes: {
        'gen_ai.usage.input_tokens': 100,
        'gen_ai.usage.output_tokens': 50,
      },
    });

    const child2 = makeSpan({
      spanId: 'child2',
      parentSpanId: 'root1',
      name: 'chat gpt-4',
      attributes: {
        'gen_ai.usage.input_tokens': 200,
        'gen_ai.usage.output_tokens': 75,
      },
    });

    exporter.export([root, child1, child2], (r) => expect(r.code).toBe(0));
    await exporter.shutdown();

    const record = JSON.parse((await readFile(filePath, 'utf8')).trim());
    expect(record.token_usage).toEqual({ input: 300, output: 125 });
  });

  it('includes tool spans in output', async () => {
    const filePath = path.join(testDir, 'simple', 'tools.jsonl');
    const exporter = new SimpleTraceFileExporter(filePath);

    const root = makeSpan({
      spanId: 'root1',
      name: 'agentv.eval',
      attributes: { 'agentv.test_id': 'test-tools' },
    });

    const toolSpan = makeSpan({
      spanId: 'tool1',
      parentSpanId: 'root1',
      name: 'execute_tool read_file',
      startTime: [1000, 0],
      endTime: [1000, 200_000_000],
      attributes: { 'gen_ai.tool.name': 'read_file' },
    });

    exporter.export([root, toolSpan], (r) => expect(r.code).toBe(0));
    await exporter.shutdown();

    const record = JSON.parse((await readFile(filePath, 'utf8')).trim());
    expect(record.spans).toHaveLength(1);
    expect(record.spans[0].type).toBe('tool');
    expect(record.spans[0].name).toBe('read_file');
    expect(record.spans[0].duration_ms).toBe(200);
  });

  it('handles multiple root spans', async () => {
    const filePath = path.join(testDir, 'simple', 'multi.jsonl');
    const exporter = new SimpleTraceFileExporter(filePath);

    const root1 = makeSpan({
      spanId: 'r1',
      name: 'agentv.eval',
      attributes: { 'agentv.test_id': 'test-1' },
    });
    const root2 = makeSpan({
      spanId: 'r2',
      name: 'agentv.eval',
      attributes: { 'agentv.test_id': 'test-2' },
    });

    exporter.export([root1, root2], (r) => expect(r.code).toBe(0));
    await exporter.shutdown();

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).test_id).toBe('test-1');
    expect(JSON.parse(lines[1]).test_id).toBe('test-2');
  });

  it('shutdown resolves cleanly without any exports', async () => {
    const filePath = path.join(testDir, 'simple', 'noop.jsonl');
    const exporter = new SimpleTraceFileExporter(filePath);
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });
});
