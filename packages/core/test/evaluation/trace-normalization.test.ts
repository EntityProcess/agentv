import { describe, expect, it } from 'bun:test';

import { buildTraceSpanTree } from '../../src/evaluation/dashboard-trace-read-model.js';
import { normalizeTraceArtifactToTraceSessionResponse } from '../../src/evaluation/trace-normalization.js';

function otlpValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(otlpValue) } };
  }
  return { stringValue: JSON.stringify(value) };
}

function attr(key: string, value: unknown): Record<string, unknown> {
  return { key, value: otlpValue(value) };
}

function fixedNow(): Date {
  return new Date('2026-06-22T10:00:00.000Z');
}

describe('Dashboard trace artifact normalization', () => {
  it('normalizes nested OTLP invoke_agent/chat/execute_tool spans into the trace-session read model', () => {
    const otlp = {
      resourceSpans: [
        {
          resource: {
            attributes: [attr('service.name', 'agentv'), attr('deployment.environment', 'test')],
          },
          scopeSpans: [
            {
              scope: { name: 'agentv', version: '1.0.0' },
              spans: [
                {
                  traceId: 'trace-1',
                  spanId: 'root',
                  name: 'invoke_agent codex',
                  kind: 0,
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '5000000000',
                  attributes: [
                    attr('gen_ai.operation.name', 'invoke_agent'),
                    attr('openinference.span.kind', 'AGENT'),
                  ],
                  status: { code: 1 },
                  events: [
                    {
                      name: 'agentv.grader.match',
                      timeUnixNano: '4900000000',
                      attributes: [
                        attr('agentv.grader.score', 0.87),
                        attr('agentv.annotation.text', 'Matched trajectory'),
                        attr('agentv.grader.passed', true),
                      ],
                    },
                  ],
                },
                {
                  traceId: 'trace-1',
                  spanId: 'chat',
                  parentSpanId: 'root',
                  name: 'chat gpt-4o',
                  kind: 0,
                  startTimeUnixNano: '2000000000',
                  endTimeUnixNano: '3000000000',
                  attributes: [
                    attr('gen_ai.operation.name', 'chat'),
                    attr('gen_ai.usage.input_tokens', 12),
                    attr('gen_ai.usage.output_tokens', 5),
                    attr('openinference.span.kind', 'LLM'),
                  ],
                  status: { code: 1 },
                },
                {
                  traceId: 'trace-1',
                  spanId: 'tool',
                  parentSpanId: 'chat',
                  name: 'execute_tool Read',
                  kind: 0,
                  startTimeUnixNano: '3100000000',
                  endTimeUnixNano: '3300000000',
                  attributes: [
                    attr('gen_ai.operation.name', 'execute_tool'),
                    attr('gen_ai.tool.name', 'Read'),
                    attr('openinference.span.kind', 'TOOL'),
                  ],
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = normalizeTraceArtifactToTraceSessionResponse(otlp, {
      runId: 'run-1',
      testId: 'test-1',
      suite: 'demo',
      target: 'codex',
      artifactPath: 'demo/test-1/outputs/trace.otlp.json',
      now: fixedNow,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(result.message);

    const session = result.traceSession;
    const tree = buildTraceSpanTree(session.spans);
    expect(session).toMatchObject({
      schema_version: 'agentv.dashboard.trace_session.v1',
      artifact_id: 'otlp-trace-trace-1',
      created_at: '2026-06-22T10:00:00.000Z',
      run_id: 'run-1',
      test_id: 'test-1',
      suite: 'demo',
      target: 'codex',
      trace_id: 'trace-1',
      root_span_id: 'root',
      resource_attributes: {
        'service.name': 'agentv',
        'deployment.environment': 'test',
      },
    });
    expect(session.artifact_links).toEqual([
      { name: 'raw_trace_path', path: 'demo/test-1/outputs/trace.otlp.json' },
    ]);
    expect(session.spans.find((span) => span.span_id === 'chat')?.token_usage).toEqual({
      input: 12,
      output: 5,
    });
    expect(session.spans[0]?.resource_attributes).toEqual({
      'service.name': 'agentv',
      'deployment.environment': 'test',
    });
    expect(session.events).toEqual([
      expect.objectContaining({
        span_id: 'root',
        kind: 'score',
        score: 0.87,
        text: 'Matched trajectory',
        passed: true,
      }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.span.name).toBe('invoke_agent codex');
    expect(tree[0]?.children[0]?.span.name).toBe('chat gpt-4o');
    expect(tree[0]?.children[0]?.children[0]?.span.name).toBe('execute_tool Read');
  });

  it('preserves multiple OTLP roots as multiple Dashboard tree roots', () => {
    const result = normalizeTraceArtifactToTraceSessionResponse(
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace-2',
                    spanId: 'root-b',
                    name: 'invoke_agent b',
                    startTimeUnixNano: '2000000000',
                  },
                  {
                    traceId: 'trace-2',
                    spanId: 'root-a',
                    name: 'invoke_agent a',
                    startTimeUnixNano: '1000000000',
                  },
                ],
              },
            ],
          },
        ],
      },
      { testId: 'multi-root', target: 'codex', now: fixedNow },
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(result.message);

    const tree = buildTraceSpanTree(result.traceSession.spans);
    expect(result.traceSession.root_span_id).toBe('root-b');
    expect(tree.map((node) => node.spanId)).toEqual(['root-a', 'root-b']);
  });

  it('returns conversion warnings for malformed and unknown OTLP fields while keeping the raw link', () => {
    const result = normalizeTraceArtifactToTraceSessionResponse(
      {
        resourceSpans: [
          {
            ignoredResourceSpanField: true,
            resource: {
              ignoredResourceField: true,
              attributes: [{ value: otlpValue('missing key') }, attr('service.name', 'agentv')],
            },
            scopeSpans: [
              {
                ignoredScopeSpanField: true,
                scope: { name: 'agentv', ignoredScopeField: true },
                spans: [
                  {
                    traceId: 'trace-warnings',
                    name: 'span without id',
                    startTimeUnixNano: 'not-a-nano',
                    mysterySpanField: true,
                    attributes: [
                      {
                        key: 'custom.unknown',
                        value: { unknownValue: 'preserved' },
                      },
                    ],
                    status: { code: 99, ignoredStatusField: true },
                    events: [{ attributes: 'not attributes' }],
                  },
                ],
              },
            ],
          },
        ],
        ignoredTopLevelField: true,
      },
      {
        testId: 'warnings',
        target: 'codex',
        artifactPath: 'demo/warnings/outputs/trace.otlp.json',
        now: fixedNow,
      },
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(result.message);

    const warningCodes = result.traceSession.conversion_warnings?.map((warning) => warning.code);
    expect(warningCodes).toContain('unknown_otlp_field');
    expect(warningCodes).toContain('malformed_otlp_attribute');
    expect(warningCodes).toContain('unknown_otlp_value_field');
    expect(warningCodes).toContain('missing_span_id');
    expect(warningCodes).toContain('malformed_unix_nano');
    expect(warningCodes).toContain('unknown_status_code');
    expect(result.traceSession.artifact_links).toEqual([
      { name: 'raw_trace_path', path: 'demo/warnings/outputs/trace.otlp.json' },
    ]);
    expect(result.traceSession.spans[0]).toMatchObject({
      span_id: 'missing-span-0-0-0',
      name: 'span without id',
      attributes: {
        'custom.unknown': { unknownValue: 'preserved' },
      },
    });
  });

  it('normalizes AgentV trace sidecars through the same entry point', () => {
    const result = normalizeTraceArtifactToTraceSessionResponse(
      {
        schema_version: 'agentv.trace.v1',
        artifact_id: 'agentv-trace-1',
        created_at: '2026-06-22T09:00:00.000Z',
        eval: {
          run_id: 'run-agentv',
          test_id: 'agentv-case',
          suite: 'demo',
          target: 'codex',
        },
        trace: {
          format: 'otlp_openinference_spans',
          trace_id: 'agentv-trace-id',
          root_span_id: 'agentv-root',
          resource: {
            attributes: { 'service.name': 'agentv-sidecar' },
          },
          spans: [
            {
              trace_id: 'agentv-trace-id',
              span_id: 'agentv-root',
              parent_span_id: null,
              name: 'invoke_agent codex',
              kind: 'INTERNAL',
              start_time_unix_nano: '1000000000',
              end_time_unix_nano: '2000000000',
              status: { code: 'OK' },
              attributes: {},
            },
          ],
        },
        source: { kind: 'agentv_run', format: 'agentv_result' },
        capture: { content: 'metadata', redaction_level: 'partial' },
        conversion_warnings: [
          {
            code: 'source_warning',
            severity: 'warning',
            message: 'Preserved warning',
          },
        ],
        artifacts: { trace_path: 'trace.json' },
      },
      { runId: 'run-agentv', artifactPath: 'demo/agentv/trace.json' },
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error(result.message);

    expect(result.format).toBe('agentv_trace_v1');
    expect(result.traceSession.resource_attributes).toEqual({
      'service.name': 'agentv-sidecar',
    });
    expect(result.traceSession.conversion_warnings).toEqual([
      expect.objectContaining({ code: 'source_warning', message: 'Preserved warning' }),
    ]);
    expect(result.traceSession.artifact_links).toEqual([
      { name: 'trace_path', path: 'trace.json' },
    ]);
  });
});
