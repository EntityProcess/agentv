import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ToolTrajectoryGrader } from '../../src/evaluation/graders/tool-trajectory.js';
import type { Message } from '../../src/evaluation/providers/types.js';
import {
  EXECUTION_TRACE_SCHEMA_VERSION,
  type TraceEnvelopeSpan,
  TraceEnvelopeWireSchema,
  buildTraceEnvelopeFromEvaluationResult,
  fromTraceEnvelopeWire,
  toTraceEnvelopeWire,
  traceEnvelopeToMessages,
  traceEnvelopeToOtlpJson,
  traceEnvelopeToToolTrajectoryView,
  traceEnvelopeToTraceArtifact,
  traceEnvelopeToTraceSummary,
} from '../../src/evaluation/trace-envelope.js';
import { buildTraceFromMessages, computeTraceSummary } from '../../src/evaluation/trace.js';
import type { EvaluationResult } from '../../src/evaluation/types.js';

function jsonComparable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function requireSpan(
  spans: readonly TraceEnvelopeSpan[],
  predicate: (span: TraceEnvelopeSpan) => boolean,
): TraceEnvelopeSpan {
  const span = spans.find(predicate);
  expect(span).toBeDefined();
  return span as TraceEnvelopeSpan;
}

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  const input: readonly Message[] = [{ role: 'user', content: 'Inspect the repository' }];
  const output: readonly Message[] = [{ role: 'assistant', content: 'Done' }];
  const base = {
    timestamp: '2026-06-15T12:00:00.000Z',
    testId: 'trace-case',
    suite: 'trace-evaluation',
    category: 'showcase',
    score: 1,
    assertions: [{ text: 'ok', passed: true }],
    target: 'replay_coding_agent',
    tokenUsage: { input: 100, output: 20, cached: 5, reasoning: 3 },
    costUsd: 0.012,
    durationMs: 4200,
    startTime: '2026-06-15T12:00:00.000Z',
    endTime: '2026-06-15T12:00:04.200Z',
    input,
    output: 'Done',
    executionStatus: 'ok',
  } satisfies Partial<EvaluationResult>;
  const result = { ...base, ...overrides } as EvaluationResult;
  return {
    ...result,
    trace:
      result.trace ??
      buildTraceFromMessages({
        input: result.input,
        output,
        finalOutput: result.output,
        tokenUsage: result.tokenUsage,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        startTime: result.startTime,
        endTime: result.endTime,
        provider: 'replay',
        target: result.target,
        testId: result.testId,
      }),
  };
}

describe('execution trace artifact v1', () => {
  it('validates and round-trips the explicit snake_case wire shape', () => {
    const envelope = buildTraceEnvelopeFromEvaluationResult(makeResult(), {
      evalPath: 'examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml',
      runId: 'run-123',
      experiment: 'execution-trace-v1',
      now: () => new Date('2026-06-15T12:00:05.000Z'),
      source: {
        metadata: {
          source_provider: 'replay',
          providerCamelKey: 'kept',
        },
      },
      artifacts: {
        execution_trace_path: 'outputs/execution-trace.json',
        transcript_path: 'outputs/transcript.jsonl',
      },
    });

    const wire = toTraceEnvelopeWire(envelope);

    expect(wire.schema_version).toBe(EXECUTION_TRACE_SCHEMA_VERSION);
    expect(wire.artifact_id).toMatch(/^execution-trace-/);
    expect(wire).not.toHaveProperty('envelope_id');
    expect(wire.created_at).toBe('2026-06-15T12:00:05.000Z');
    expect(wire.eval.eval_path).toContain('coding-agent-replay.eval.yaml');
    expect(wire.trace.format).toBe('otlp_openinference_spans');
    expect(wire.trace.spans[0]?.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(wire.trace.spans[0]?.attributes['openinference.span.kind']).toBe('AGENT');
    expect(wire.source.metadata).toMatchObject({
      source_provider: 'replay',
      providerCamelKey: 'kept',
    });
    expect(wire.source.metadata).not.toHaveProperty('sourceProvider');
    expect(wire.source.metadata).not.toHaveProperty('provider_camel_key');
    expect(TraceEnvelopeWireSchema.parse(wire).trace.spans.length).toBeGreaterThanOrEqual(2);
    expect(jsonComparable(fromTraceEnvelopeWire(wire))).toEqual(jsonComparable(envelope));
  });

  it('defaults to metadata-only capture while preserving trace structure', () => {
    const envelope = buildTraceEnvelopeFromEvaluationResult(makeResult());
    const spans = envelope.trace.spans;
    const root = spans.find((span) => span.spanId === envelope.trace.rootSpanId);
    const chat = spans.find((span) => span.attributes['gen_ai.operation.name'] === 'chat');

    expect(envelope.capture.content).toBe('metadata');
    expect(envelope.capture.redactionLevel).toBe('partial');
    expect(root?.name).toBe('invoke_agent replay_coding_agent');
    expect(root?.attributes['openinference.span.kind']).toBe('AGENT');
    expect(chat?.attributes['openinference.span.kind']).toBe('LLM');
    expect(chat?.attributes).not.toHaveProperty('gen_ai.output.messages');
    expect(spans).toHaveLength(2);
  });

  it('creates ordered tool spans with chat parentage and deterministic generated IDs', () => {
    const output: readonly Message[] = [
      {
        role: 'assistant',
        content: 'I will inspect and edit.',
        startTime: '2026-06-15T12:00:01.000Z',
        endTime: '2026-06-15T12:00:04.000Z',
        toolCalls: [
          {
            tool: 'Read',
            id: 'call-read',
            input: { file_path: 'src/config.ts' },
            output: { content: 'timeout = 0' },
            startTime: '2026-06-15T12:00:02.000Z',
            endTime: '2026-06-15T12:00:02.120Z',
          },
          {
            tool: 'Edit',
            input: { file_path: 'src/config.ts' },
            output: { changed: true },
            durationMs: 40,
            startTime: '2026-06-15T12:00:03.000Z',
          },
        ],
      },
    ];
    const result = makeResult({
      output: 'I will inspect and edit.',
      trace: buildTraceFromMessages({
        input: [{ role: 'user', content: 'Fix config' }],
        output,
        finalOutput: 'I will inspect and edit.',
        target: 'codex',
        testId: 'tool-case',
      }),
    });

    const first = buildTraceEnvelopeFromEvaluationResult(result);
    const second = buildTraceEnvelopeFromEvaluationResult(result);
    const toolSpans = first.trace.spans.filter(
      (span) => span.attributes['gen_ai.operation.name'] === 'execute_tool',
    );
    const chat = first.trace.spans.find(
      (span) => span.attributes['gen_ai.operation.name'] === 'chat',
    );

    expect(toolSpans.map((span) => span.attributes['gen_ai.tool.name'])).toEqual(['Read', 'Edit']);
    expect(toolSpans.map((span) => span.parentSpanId)).toEqual([chat?.spanId, chat?.spanId]);
    expect(toolSpans[0]?.attributes['gen_ai.tool.call.id']).toBe('call-read');
    expect(toolSpans[1]?.attributes['agentv.generated_tool_call_id']).toBe(true);
    expect(toolSpans[1]?.attributes['gen_ai.tool.call.id']).toBe(
      second.trace.spans.find((span) => span.name === 'execute_tool Edit')?.attributes[
        'gen_ai.tool.call.id'
      ],
    );
    expect(first.conversionWarnings).toEqual([
      {
        code: 'missing_tool_call_id',
        severity: 'warning',
        spanId: toolSpans[1]?.spanId,
        sourceRef: { eventId: 'message-1-tool-1' },
        message: 'Deterministic tool call id generated from source order.',
      },
    ]);
  });

  it('keeps opaque full-capture payload keys unchanged', () => {
    const content = [
      {
        type: 'image',
        media_type: 'image/png',
        providerCamelKey: 'content stays camelCase',
      },
    ] as unknown as Message['content'];
    const toolInput = {
      snake_value: 'input stays snake_case',
      providerCamelKey: 'input stays camelCase',
    };
    const toolOutput = {
      snake_value: 'output stays snake_case',
      providerCamelKey: 'output stays camelCase',
    };
    const result = makeResult({
      output: 'Used a tool',
      trace: buildTraceFromMessages({
        output: [
          {
            role: 'assistant',
            content,
            metadata: {
              snake_value: 'metadata stays snake_case',
              providerCamelKey: 'metadata stays camelCase',
            },
            toolCalls: [
              { tool: 'Inspect', id: 'call-inspect', input: toolInput, output: toolOutput },
            ],
          },
        ],
        finalOutput: 'Used a tool',
        target: 'codex',
        testId: 'opaque-case',
      }),
    });

    const wire = toTraceEnvelopeWire(
      buildTraceEnvelopeFromEvaluationResult(result, {
        capture: { content: 'full', redactionLevel: 'none', redactedFields: [] },
      }),
    );
    const chat = wire.trace.spans.find(
      (span) => span.attributes['gen_ai.operation.name'] === 'chat',
    );
    const tool = wire.trace.spans.find(
      (span) => span.attributes['gen_ai.operation.name'] === 'execute_tool',
    );

    expect(chat?.attributes['gen_ai.output.messages']).toEqual(content);
    expect(tool?.attributes['gen_ai.tool.call.arguments']).toEqual(toolInput);
    expect(tool?.attributes['gen_ai.tool.call.result']).toEqual(toolOutput);
    for (const payload of [
      (chat?.attributes['gen_ai.output.messages'] as Record<string, unknown>[])[0],
      tool?.attributes['gen_ai.tool.call.arguments'] as Record<string, unknown>,
      tool?.attributes['gen_ai.tool.call.result'] as Record<string, unknown>,
    ]) {
      expect(payload).toHaveProperty('providerCamelKey');
      expect(payload).not.toHaveProperty('provider_camel_key');
      expect(payload).not.toHaveProperty('snakeValue');
    }
  });

  it('maps metrics, execution status, and score provenance', () => {
    const result = makeResult({
      executionStatus: 'execution_error',
      error: 'Provider timed out',
      scores: [
        {
          name: 'expected-tool-sequence',
          type: 'tool-trajectory',
          score: 1,
          verdict: 'pass',
          assertions: [{ text: 'Read before Edit', passed: true, evidence: 'span evidence' }],
          details: {
            snake_value: 'score detail stays snake_case',
            providerCamelKey: 'score detail stays camelCase',
          },
          endedAt: '2026-06-15T12:00:05.000Z',
        },
      ],
    });

    const envelope = buildTraceEnvelopeFromEvaluationResult(result);
    const root = envelope.trace.spans.find((span) => span.spanId === envelope.trace.rootSpanId);
    const summary = traceEnvelopeToTraceSummary(envelope);
    const otlp = traceEnvelopeToOtlpJson(envelope);
    const otlpRoot = otlp.resourceSpans[0]?.scopeSpans[0]?.spans.find(
      (span) => span.spanId === envelope.trace.rootSpanId,
    );

    expect(root?.status).toEqual({ code: 'ERROR', message: 'Provider timed out' });
    expect(otlpRoot?.kind).toBe(0);
    expect(otlpRoot?.status).toEqual({ code: 2, message: 'Provider timed out' });
    expect(root?.attributes['gen_ai.usage.input_tokens']).toBe(100);
    expect(root?.attributes['agentv.trace.cost_usd']).toBe(0.012);
    expect(summary.tokenUsage).toEqual({ input: 100, output: 20, cached: 5, reasoning: 3 });
    expect(summary.costUsd).toBe(0.012);
    expect(summary.durationMs).toBe(4200);
    expect(envelope.scores?.[0]).toMatchObject({
      name: 'expected-tool-sequence',
      type: 'tool-trajectory',
      source: 'agentv',
      evaluatedAt: '2026-06-15T12:00:05.000Z',
      targetSpanId: envelope.trace.rootSpanId,
    });
    expect(envelope.scores?.[0]?.evidence?.details).toMatchObject({
      snake_value: 'score detail stays snake_case',
      providerCamelKey: 'score detail stays camelCase',
    });
  });

  it('projects Message[], TraceSummary, trajectory, tool grader input, and OTLP JSON from spans', () => {
    const output: readonly Message[] = [
      {
        role: 'assistant',
        toolCalls: [
          { tool: 'Read', id: 'call-read', durationMs: 10 },
          { tool: 'Edit', id: 'call-edit', durationMs: 20 },
        ],
      },
    ];
    const result = makeResult({
      trace: buildTraceFromMessages({
        input: [{ role: 'user', content: 'Fix it' }],
        output,
        target: 'codex',
        testId: 'projection-case',
      }),
    });
    const envelope = buildTraceEnvelopeFromEvaluationResult(result);
    const messages = traceEnvelopeToMessages(envelope);
    const summary = traceEnvelopeToTraceSummary(envelope);
    const trajectory = traceEnvelopeToTraceArtifact(envelope);
    const compact = traceEnvelopeToToolTrajectoryView(envelope);
    const otlp = traceEnvelopeToOtlpJson(envelope);
    const grader = new ToolTrajectoryGrader({
      config: {
        name: 'expected-tool-sequence',
        type: 'tool-trajectory',
        mode: 'exact',
        expected: [{ tool: 'Read' }, { tool: 'Edit' }],
      },
    });

    expect(summary.trace).toEqual(computeTraceSummary(output).trace);
    expect(messages[0]?.toolCalls?.map((toolCall) => toolCall.tool)).toEqual(['Read', 'Edit']);
    expect(trajectory.events.map((event) => event.type)).toEqual([
      'model_turn',
      'tool_call',
      'tool_call',
    ]);
    expect(compact.tools.map((tool) => [tool.position, tool.tool, tool.toolCallId])).toEqual([
      [0, 'Read', 'call-read'],
      [1, 'Edit', 'call-edit'],
    ]);
    expect(grader.evaluate({ output: messages, trace: summary.trace } as never)).toMatchObject({
      score: 1,
      verdict: 'pass',
    });
    expect(otlp.resourceSpans[0]?.scopeSpans[0]?.spans.map((span) => span.name)).toEqual([
      'invoke_agent replay_coding_agent',
      'chat replay_coding_agent',
      'execute_tool Read',
      'execute_tool Edit',
    ]);
    const otlpRead = otlp.resourceSpans[0]?.scopeSpans[0]?.spans.find(
      (span) => span.name === 'execute_tool Read',
    );
    expect(otlpRead?.kind).toBe(0);
    expect(otlpRead?.status).toEqual({ code: 1 });
    expect(otlpRead?.parentSpanId).toBe(
      envelope.trace.spans.find((span) => span.name === 'chat replay_coding_agent')?.spanId,
    );
  });

  it('orders span projections by numeric nanosecond timestamps', () => {
    const output: readonly Message[] = [
      {
        role: 'assistant',
        content: 'early',
        toolCalls: [{ tool: 'EarlyTool', id: 'call-early' }],
      },
      {
        role: 'assistant',
        content: 'late',
        toolCalls: [{ tool: 'LateTool', id: 'call-late' }],
      },
    ];
    const envelope = buildTraceEnvelopeFromEvaluationResult(
      makeResult({
        trace: buildTraceFromMessages({
          input: [{ role: 'user', content: 'Sort non-padded nanoseconds' }],
          output,
          finalOutput: 'late',
          target: 'codex',
          testId: 'timestamp-ordering-case',
        }),
      }),
      { capture: { content: 'full', redactionLevel: 'none', redactedFields: [] } },
    );
    const root = requireSpan(
      envelope.trace.spans,
      (span) => span.spanId === envelope.trace.rootSpanId,
    );
    const earlyChat = requireSpan(
      envelope.trace.spans,
      (span) => span.attributes['gen_ai.output.messages'] === 'early',
    );
    const earlyTool = requireSpan(
      envelope.trace.spans,
      (span) => span.name === 'execute_tool EarlyTool',
    );
    const lateChat = requireSpan(
      envelope.trace.spans,
      (span) => span.attributes['gen_ai.output.messages'] === 'late',
    );
    const lateTool = requireSpan(
      envelope.trace.spans,
      (span) => span.name === 'execute_tool LateTool',
    );
    const retime = (
      span: TraceEnvelopeSpan,
      startTimeUnixNano: string,
      endTimeUnixNano: string,
    ) => ({
      ...span,
      startTimeUnixNano,
      endTimeUnixNano,
    });
    const shuffled = {
      ...envelope,
      trace: {
        ...envelope.trace,
        spans: [
          retime(root, '0', '2000000000'),
          retime(lateTool, '1010000000', '1020000000'),
          retime(lateChat, '1000000000', '1100000000'),
          retime(earlyTool, '910000000', '920000000'),
          retime(earlyChat, '900000000', '990000000'),
        ],
      },
    };

    expect(traceEnvelopeToMessages(shuffled).map((message) => message.content)).toEqual([
      'early',
      'late',
    ]);
    expect(traceEnvelopeToToolTrajectoryView(shuffled).tools.map((tool) => tool.tool)).toEqual([
      'EarlyTool',
      'LateTool',
    ]);
    expect(
      traceEnvelopeToTraceArtifact(shuffled).events.map((event) => event.sourceRef?.spanId),
    ).toEqual([earlyChat.spanId, earlyTool.spanId, lateChat.spanId, lateTool.spanId]);
    expect(
      traceEnvelopeToOtlpJson(shuffled).resourceSpans[0]?.scopeSpans[0]?.spans.map(
        (span) => span.spanId,
      ),
    ).toEqual([root.spanId, earlyChat.spanId, earlyTool.spanId, lateChat.spanId, lateTool.spanId]);
  });

  it('keeps nested subagent parent-child spans visible in golden projections', () => {
    const fixturePath = path.join(
      import.meta.dir,
      'fixtures',
      'execution-trace',
      'nested-subagent.json',
    );
    const envelope = fromTraceEnvelopeWire(JSON.parse(readFileSync(fixturePath, 'utf8')));
    const wire = toTraceEnvelopeWire(envelope);
    const messages = traceEnvelopeToMessages(envelope);
    const compact = traceEnvelopeToToolTrajectoryView(envelope);
    const otlp = traceEnvelopeToOtlpJson(envelope);

    expect(wire.schema_version).toBe(EXECUTION_TRACE_SCHEMA_VERSION);
    expect(wire.source.metadata).toMatchObject({
      source_provider: 'codex',
      providerCamelKey: 'kept',
    });

    const runSubagent = compact.tools.find((tool) => tool.tool === 'runSubagent');
    const nestedRead = compact.tools.find((tool) => tool.tool === 'Read');
    expect(runSubagent?.parentToolCallId).toBeUndefined();
    expect(nestedRead).toMatchObject({
      toolCallId: 'call-nested-read',
      parentToolCallId: 'call-subagent',
      input: {
        file_path: 'src/config.ts',
        providerCamelKey: 'input kept',
      },
      output: {
        line_count: 12,
        providerCamelKey: 'output kept',
      },
    });
    expect(nestedRead?.ancestorSpanIds).toContain(runSubagent?.spanId);

    expect(messages.map((message) => message.metadata)).toEqual([
      {
        span_id: 'chat000000000001',
        trace_id: '11111111111111111111111111111111',
        parent_span_id: 'root000000000001',
      },
      {
        span_id: 'chat000000000002',
        trace_id: '11111111111111111111111111111111',
        parent_span_id: 'agent00000000001',
        parent_tool_call_id: 'call-subagent',
      },
    ]);

    const otlpSpans = otlp.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    const subagent = otlpSpans.find((span) => span.spanId === 'agent00000000001');
    const nestedChat = otlpSpans.find((span) => span.spanId === 'chat000000000002');
    const nestedTool = otlpSpans.find((span) => span.spanId === 'tool000000000002');
    expect(subagent?.parentSpanId).toBe('tool000000000001');
    expect(nestedChat?.parentSpanId).toBe('agent00000000001');
    expect(nestedTool?.parentSpanId).toBe('chat000000000002');
  });
});
