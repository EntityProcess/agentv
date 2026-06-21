import { describe, expect, it } from 'bun:test';

import {
  traceSessionEnvelopeFixture,
  traceSessionMissingOptionalFixture,
} from './__fixtures__/trace-session-read-model';
import {
  type TraceSpanNode,
  buildTraceSpanTree,
  traceEnvelopeToTraceSessionResponse,
} from './trace-read-model';

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

function flattenTree(nodes: readonly TraceSpanNode[]): TraceSpanNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
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
      artifact_links: [
        { name: 'answer_path', path: 'outputs/answer.md' },
        { name: 'trace_path', path: 'outputs/trace.json' },
        { name: 'transcript_path', path: 'outputs/transcript.jsonl' },
      ],
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
    expect(root?.attributes?.['gen_ai.usage.input_tokens']).toBe(14);
    expect(root?.attributes).not.toHaveProperty('external_trace_url');
    expect(root?.attributes).not.toHaveProperty('external_trace_token');
    expect(root?.attributes).not.toHaveProperty('access_token');

    expect(session.events.map((event) => [event.event_id, event.kind, event.name])).toEqual([
      ['annotation-1', 'annotation', 'agentv.annotation'],
      ['score-1', 'score', 'agentv.score'],
    ]);
    expect(session.events[0]).toMatchObject({
      text: 'Reviewer note',
      passed: true,
      attributes: { extra_context: { source: 'grader' }, nested: { safe_value: 'visible' } },
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
    expect(session.conversion_warnings).toEqual([
      {
        code: 'missing_event_time',
        severity: 'warning',
        span_id: 'child-chat',
        source_ref: {
          event_id: 'raw-event-1',
          span_id: 'child-chat',
          trace_id: 'trace-123',
          raw_kind: 'codex_event',
          path: 'outputs/raw/events.jsonl',
          line: 7,
          metadata: {
            safe_value: 'visible',
            messages: [{ safe_value: 'visible', nested: { keep: 'yes' } }],
          },
        },
        message: 'Converted event did not include a timestamp.',
        details: {
          raw_kind: 'codex_event',
          nested: { safe_value: 'visible' },
          messages: [{ safe_value: 'visible', nested: { keep: 'yes' } }],
        },
      },
      {
        code: 'unsafe_source_ref_path',
        severity: 'warning',
        source_ref: {
          span_id: 'grandchild-tool',
          metadata: { messages: [{ safe_value: 'visible' }] },
        },
        message: 'External-looking source path omitted.',
        details: {
          messages: [{ safe_value: 'visible' }],
        },
      },
    ]);
  });

  it('keeps external_trace links safe and leaves AgentV as canonical source', () => {
    const session = traceEnvelopeToTraceSessionResponse(traceSessionEnvelopeFixture);

    expect(session.external_trace).toEqual({
      provider: 'phoenix',
      source: 'codex',
      project: 'agentv-dogfood',
      session_id: 'codex-session-123',
      trace_id: 'phoenix-trace-456',
      ui_url: 'https://phoenix.example/projects/agentv-dogfood/traces/phoenix-trace-456',
      run_id: '2026-06-21T10-00-00-000Z',
      test_id: 'nested-session',
      target: 'codex',
    });
    expect(JSON.stringify(session.external_trace)).not.toContain('secret');
    expect(JSON.stringify(session.external_trace)).not.toContain('api_key');
    expect(JSON.stringify(session)).not.toContain('secret');
    expect(JSON.stringify(session)).not.toContain('api_key');
    expect(JSON.stringify(session.artifact_links)).not.toContain('unsafe_url_path');
    expect(JSON.stringify(session.artifact_links)).not.toContain('traversal_path');
    expect(JSON.stringify(session.artifact_links)).not.toContain('secret_token_path');
    expect(JSON.stringify(session.artifact_links)).not.toContain('unc_path');
    expect(JSON.stringify(session.artifact_links)).not.toContain('evil.example');
    expect(JSON.stringify(session.conversion_warnings)).not.toContain('authorization');
    expect(JSON.stringify(session.conversion_warnings)).not.toContain('Bearer');
    expect(JSON.stringify(session.conversion_warnings)).not.toContain('empty_messages');
    expect(JSON.stringify(session.conversion_warnings)).not.toContain('evil.example');
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

  it('preserves duplicate span IDs with collision-free node IDs and diagnostics', () => {
    const tree = buildTraceSpanTree([
      {
        id: 'root',
        span_id: 'root',
        parent_span_id: null,
        name: 'root',
        start_time_unix_nano: '1000',
      },
      {
        id: 'dup',
        span_id: 'dup',
        parent_span_id: 'root',
        name: 'first duplicate',
        start_time_unix_nano: '1100',
      },
      {
        id: 'dup',
        span_id: 'dup',
        parent_span_id: 'root',
        name: 'second duplicate',
        start_time_unix_nano: '1200',
      },
    ]);
    const nodes = flattenTree(tree);

    expect(nodes.map((node) => node.id)).toEqual(['root', 'dup', 'dup#2']);
    expect(nodes.map((node) => node.span.name)).toEqual([
      'root',
      'first duplicate',
      'second duplicate',
    ]);
    expect(nodes[2].diagnostics?.map((diagnostic) => diagnostic.code)).toEqual([
      'duplicate_span_id',
    ]);
  });

  it('promotes self-parented spans and ancestor cycles to diagnostic roots', () => {
    const tree = buildTraceSpanTree([
      {
        id: 'self',
        span_id: 'self',
        parent_span_id: 'self',
        name: 'self',
        start_time_unix_nano: '3000',
      },
      {
        id: 'cycle-a',
        span_id: 'cycle-a',
        parent_span_id: 'cycle-b',
        name: 'cycle-a',
        start_time_unix_nano: '1000',
      },
      {
        id: 'cycle-b',
        span_id: 'cycle-b',
        parent_span_id: 'cycle-a',
        name: 'cycle-b',
        start_time_unix_nano: '2000',
      },
    ]);
    const nodes = flattenTree(tree);

    expect(tree.map((node) => node.spanId)).toEqual(['cycle-a', 'cycle-b', 'self']);
    expect(nodes.every((node) => node.children.length === 0)).toBe(true);
    expect(nodes.map((node) => node.diagnostics?.[0]?.code)).toEqual([
      'cycle',
      'cycle',
      'self_parent',
    ]);
  });

  it('keeps missing-ID and missing-parent spans as diagnostic roots', () => {
    const tree = buildTraceSpanTree([
      {
        id: '',
        span_id: '',
        parent_span_id: null,
        name: 'missing id',
      },
      {
        id: 'orphan',
        span_id: 'orphan',
        parent_span_id: 'missing-parent',
        name: 'orphan',
      },
    ]);

    expect(tree.map((node) => node.id)).toEqual(['missing-span-0', 'orphan']);
    expect(tree.map((node) => node.diagnostics?.[0]?.code)).toEqual([
      'missing_span_id',
      'missing_parent',
    ]);
  });

  it('sorts roots and children by start time with stable span ID tie breaks', () => {
    const tree = buildTraceSpanTree([
      {
        id: 'root-b',
        span_id: 'root-b',
        parent_span_id: null,
        name: 'root-b',
        start_time_unix_nano: '2000',
      },
      {
        id: 'child-late',
        span_id: 'child-late',
        parent_span_id: 'root-a',
        name: 'child-late',
        start_time_unix_nano: '1200',
      },
      {
        id: 'root-a',
        span_id: 'root-a',
        parent_span_id: null,
        name: 'root-a',
        start_time_unix_nano: '1000',
      },
      {
        id: 'child-early',
        span_id: 'child-early',
        parent_span_id: 'root-a',
        name: 'child-early',
        start_time_unix_nano: '1100',
      },
      {
        id: 'child-alpha',
        span_id: 'child-alpha',
        parent_span_id: 'root-a',
        name: 'child-alpha',
        start_time_unix_nano: '1200',
      },
    ]);

    expect(tree.map((node) => node.spanId)).toEqual(['root-a', 'root-b']);
    expect(tree[0].children.map((node) => node.spanId)).toEqual([
      'child-early',
      'child-alpha',
      'child-late',
    ]);
  });

  it('keeps new API fixtures snake_case-only outside opaque attributes maps', () => {
    expectSnakeCaseFixtureKeys(traceSessionEnvelopeFixture);
    expectSnakeCaseFixtureKeys(traceSessionMissingOptionalFixture);
  });
});
