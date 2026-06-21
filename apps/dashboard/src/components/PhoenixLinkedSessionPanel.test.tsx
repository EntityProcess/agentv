import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PhoenixLinkedSessionResponse } from '~/lib/types';

import { PhoenixLinkedSessionPanelContent } from './PhoenixLinkedSessionPanel';

describe('PhoenixLinkedSessionPanelContent', () => {
  it('renders linked session summary, turns, trace tree, and selected span detail', () => {
    const response: PhoenixLinkedSessionResponse = {
      schema_version: 'agentv.dashboard.phoenix_session.v1',
      status: 'ok',
      open_in_phoenix_url: 'https://phoenix.example/sessions/codex-session-1',
      external_trace: {
        provider: 'phoenix',
        session_id: 'codex-session-1',
      },
      session: {
        session_id: 'codex-session-1',
        project_id: 'project-1',
        trace_count: 1,
        duration_ms: 4200,
        token_usage: { input: 12, output: 8, total: 20 },
        cost_usd: 0.02,
        start_time: '2026-03-25T10:00:00.000Z',
      },
      turns: [
        {
          index: 1,
          trace_id: 'trace-1',
          duration_ms: 4200,
          root_span_id: 'span-root',
          input: 'summarize the repo',
          output: 'repo summary',
        },
      ],
      spans: [
        {
          span_id: 'span-root',
          trace_id: 'trace-1',
          name: 'agent turn',
          status: 'OK',
          input: 'summarize the repo',
          output: 'repo summary',
          token_usage: { total: 20 },
          attributes: { 'openinference.span.kind': 'LLM' },
        },
      ],
      trace_tree: [
        {
          span_id: 'span-root',
          trace_id: 'trace-1',
          name: 'agent turn',
          depth: 0,
          child_count: 1,
          duration_ms: 4200,
        },
        {
          span_id: 'span-child',
          trace_id: 'trace-1',
          parent_span_id: 'span-root',
          name: 'tool call',
          depth: 1,
          child_count: 0,
          duration_ms: 900,
        },
      ],
      annotations: [{ name: 'review', target: 'session', label: 'pass' }],
    };

    const html = renderToStaticMarkup(
      <PhoenixLinkedSessionPanelContent response={response} initialSpanId="span-root" />,
    );

    expect(html).toContain('Phoenix Session');
    expect(html).toContain('codex-session-1');
    expect(html).toContain('Open in Phoenix');
    expect(html).toContain('summarize the repo');
    expect(html).toContain('repo summary');
    expect(html).toContain('agent turn');
    expect(html).toContain('tool call');
    expect(html).toContain('openinference.span.kind');
  });

  it('renders recoverable unresolved state', () => {
    const html = renderToStaticMarkup(
      <PhoenixLinkedSessionPanelContent
        response={{
          schema_version: 'agentv.dashboard.phoenix_session.v1',
          status: 'unresolved',
          message: 'No Phoenix session matched the external_trace correlation metadata.',
          open_in_phoenix_url: 'https://phoenix.example/projects/demo/traces/trace-1',
        }}
      />,
    );

    expect(html).toContain('Phoenix Session');
    expect(html).toContain('unresolved');
    expect(html).toContain('No Phoenix session matched');
    expect(html).toContain('Open in Phoenix');
  });
});
