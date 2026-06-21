import { describe, expect, it } from 'bun:test';

import {
  traceSessionEnvelopeFixture,
  traceSessionMissingOptionalFixture,
} from './__fixtures__/trace-session-read-model';
import { buildTraceSpanTree, traceEnvelopeToTraceSessionResponse } from './trace-read-model';

function expectSnakeCaseFixtureKeys(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => expectSnakeCaseFixtureKeys(entry, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const parentKey = path.at(-1);
    if (parentKey !== 'attributes') {
      expect(key, [...path, key].join('.')).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expectSnakeCaseFixtureKeys(entry, [...path, key]);
  }
}

describe('trace session read model', () => {
  it('projects snake_case trace artifacts into stable Dashboard span trees', () => {
    const session = traceEnvelopeToTraceSessionResponse(traceSessionEnvelopeFixture, {
      artifactPath: 'nested-session__codex/outputs/trace.json',
    });
    const tree = buildTraceSpanTree(session.spans);

    expect(session).toMatchObject({
      schema_version: 'agentv.dashboard.trace_session.v1',
      run_id: '2026-06-21T10-00-00-000Z',
      test_id: 'nested-session',
      target: 'codex',
      trace_id: 'trace-123',
      root_span_id: 'root-span',
      source: {
        artifact_path: 'nested-session__codex/outputs/trace.json',
      },
    });
    expect(session.spans.map((span) => span.id)).toEqual([
      'root-span',
      'child-chat',
      'grandchild-tool',
    ]);
    expect(session.spans.map((span) => span.parent_span_id)).toEqual([
      null,
      'root-span',
      'child-chat',
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].spanId).toBe('root-span');
    expect(tree[0].children[0].spanId).toBe('child-chat');
    expect(tree[0].children[0].children[0].spanId).toBe('grandchild-tool');
  });

  it('preserves score events, annotation events, scores, and unknown attributes', () => {
    const session = traceEnvelopeToTraceSessionResponse(traceSessionEnvelopeFixture);
    const root = session.spans.find((span) => span.span_id === 'root-span');

    expect(root?.duration_ms).toBe(1500);
    expect(root?.token_usage).toEqual({ input: 14, output: 9 });
    expect(root?.attributes?.['custom.unknown_value']).toEqual({ nested_value: true });

    expect(session.events.map((event) => [event.event_id, event.kind, event.name])).toEqual([
      ['annotation-1', 'annotation', 'agentv.annotation'],
      ['score-1', 'score', 'agentv.score'],
    ]);
    expect(session.events[0]).toMatchObject({
      text: 'Reviewer note',
      passed: true,
      attributes: { extra_context: { source: 'grader' } },
    });
    expect(session.events[1]).toMatchObject({
      score: 0.82,
      text: 'Rubric score',
      passed: true,
    });
    expect(session.scores).toEqual([
      {
        name: 'rubric',
        type: 'llm-grader',
        score: 0.82,
        weight: 1,
        verdict: 'pass',
        source: 'llm',
        evaluated_at: '2026-06-21T10:00:02.300Z',
        target_span_id: 'root-span',
        evidence: {
          assertions: [{ text: 'Rubric score', passed: true }],
        },
      },
    ]);
  });

  it('keeps external_trace links safe and leaves AgentV as canonical source', () => {
    const session = traceEnvelopeToTraceSessionResponse(traceSessionEnvelopeFixture);

    expect(session.external_trace).toEqual({
      provider: 'phoenix',
      project: 'agentv-dogfood',
      session_id: 'codex-session-123',
      trace_id: 'phoenix-trace-456',
      url: 'https://phoenix.example/projects/agentv-dogfood/traces/phoenix-trace-456',
    });
    expect(JSON.stringify(session.external_trace)).not.toContain('secret');
    expect(JSON.stringify(session.external_trace)).not.toContain('api_key');
    expect(session.source?.metadata).toEqual({
      safe_note: 'local artifact remains canonical',
    });
  });

  it('does not invent zero timing, token usage, or broken external links for missing fields', () => {
    const session = traceEnvelopeToTraceSessionResponse(traceSessionMissingOptionalFixture);
    const root = session.spans[0];

    expect(root.start_time_unix_nano).toBeUndefined();
    expect(root.end_time_unix_nano).toBeUndefined();
    expect(root.start_time).toBeUndefined();
    expect(root.end_time).toBeUndefined();
    expect(root.duration_ms).toBeUndefined();
    expect(root.token_usage).toBeUndefined();
    expect(session.external_trace).toEqual({
      provider: 'codex',
      session_id: 'codex-session-789',
    });
    expect(JSON.stringify(session.external_trace)).not.toContain('secret');
    expect(JSON.stringify(session.external_trace)).not.toContain('not-a-url');
  });

  it('keeps new API fixtures snake_case-only outside opaque attributes maps', () => {
    expectSnakeCaseFixtureKeys(traceSessionEnvelopeFixture);
    expectSnakeCaseFixtureKeys(traceSessionMissingOptionalFixture);
  });
});
