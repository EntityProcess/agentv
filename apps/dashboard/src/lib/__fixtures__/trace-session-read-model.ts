export const traceSessionEnvelopeFixture = {
  schema_version: 'agentv.trace.v1',
  artifact_id: 'execution-trace-fixture',
  created_at: '2026-06-21T10:00:00.000Z',
  eval: {
    run_id: '2026-06-21T10-00-00-000Z',
    test_id: 'nested-session',
    suite: 'evals/github-backed.eval.yaml',
    target: 'codex',
  },
  trace: {
    format: 'otlp_openinference_spans',
    trace_id: 'trace-123',
    root_span_id: 'root-span',
    spans: [
      {
        trace_id: 'trace-123',
        span_id: 'root-span',
        parent_span_id: null,
        name: 'invoke_agent codex',
        kind: 'INTERNAL',
        start_time_unix_nano: '1000000000',
        end_time_unix_nano: '2500000000',
        status: { code: 'OK' },
        attributes: {
          'agentv.test_id': 'nested-session',
          'agentv.target': 'codex',
          'custom.unknown_value': { nested_value: true },
          external_trace_url:
            'https://phoenix.example/projects/agentv-dogfood/traces/phoenix-trace-456?api_key=secret',
          external_trace_token: 'secret-span-token',
          access_token: 'secret-access-token',
          'gen_ai.usage.input_tokens': 14,
          'gen_ai.usage.output_tokens': 9,
        },
        events: [
          {
            name: 'agentv.annotation',
            time_unix_nano: '1200000000',
            attributes: {
              event_id: 'annotation-1',
              text: 'Reviewer note',
              passed: true,
              extra_context: { source: 'grader' },
              authorization: 'Bearer secret',
              nested: { password: 'secret', safe_value: 'visible' },
            },
          },
          {
            name: 'agentv.score',
            time_unix_nano: '2300000000',
            attributes: {
              event_id: 'score-1',
              score: 0.82,
              text: 'Rubric score',
              passed: true,
            },
          },
        ],
      },
      {
        trace_id: 'trace-123',
        span_id: 'child-chat',
        parent_span_id: 'root-span',
        name: 'chat gpt-5-codex',
        kind: 'INTERNAL',
        start_time_unix_nano: '1300000000',
        end_time_unix_nano: '2200000000',
        status: { code: 'OK' },
        attributes: {
          'gen_ai.operation.name': 'chat',
          'openinference.span.kind': 'LLM',
        },
        events: [],
      },
      {
        trace_id: 'trace-123',
        span_id: 'grandchild-tool',
        parent_span_id: 'child-chat',
        name: 'execute_tool read_file',
        kind: 'INTERNAL',
        start_time_unix_nano: '1500000000',
        end_time_unix_nano: '1700000000',
        status: { code: 'OK' },
        attributes: {
          'gen_ai.tool.name': 'read_file',
          'tool.name': 'read_file',
        },
        events: [],
      },
    ],
  },
  source: {
    kind: 'agentv_run',
    path: 'index.jsonl',
    provider: 'codex',
    format: 'agentv_result',
    version: '1',
    metadata: {
      external_trace: {
        provider: 'phoenix',
        source: 'codex',
        endpoint: 'https://phoenix.example/v1/traces?authorization=secret',
        project: 'agentv-dogfood',
        project_id: 'project-1',
        session_id: 'codex-session-123',
        session_node_id: 'UHJvamVjdFNlc3Npb246MQ==',
        trace_id: 'phoenix-trace-456',
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        ui_url:
          'https://phoenix.example/projects/agentv-dogfood/traces/phoenix-trace-456?api_key=secret',
        run_id: '2026-06-21T10-00-00-000Z',
        test_id: 'nested-session',
        target: 'codex',
        api_key: 'secret',
      },
      safe_note: 'local artifact remains canonical',
      access_token: 'secret',
    },
  },
  artifacts: {
    trace_path: 'outputs/trace.json',
    answer_path: 'outputs/answer.md',
    transcript_path: 'outputs/transcript.jsonl',
    secret_token_path: 'outputs/secret-token.txt',
    unsafe_url_path: 'https://phoenix.example/artifacts/trace.json?api_key=secret',
    traversal_path: '../outside/trace.json',
    unc_path: '\\\\evil.example\\share\\trace.json',
  },
  conversion_warnings: [
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
          authorization: 'Bearer secret',
          messages: [
            { authorization: 'Bearer nested secret' },
            {
              safe_value: 'visible',
              nested: { keep: 'yes', refresh_token: 'secret' },
            },
          ],
        },
      },
      message: 'Converted event did not include a timestamp.',
      details: {
        raw_kind: 'codex_event',
        nested: {
          safe_value: 'visible',
          refresh_token: 'secret',
        },
        messages: [
          { authorization: 'Bearer detail secret' },
          {
            safe_value: 'visible',
            nested: { keep: 'yes', token: 'secret' },
          },
        ],
        empty_messages: [{ authorization: 'Bearer only secret' }],
      },
    },
    {
      code: 'unsafe_source_ref_path',
      severity: 'warning',
      source_ref: {
        span_id: 'grandchild-tool',
        path: '\\\\evil.example\\share\\trace.json',
        metadata: {
          messages: [{ authorization: 'Bearer secret' }, { safe_value: 'visible' }],
        },
      },
      message: 'External-looking source path omitted.',
      details: {
        messages: [{ authorization: 'Bearer secret' }, { safe_value: 'visible' }],
      },
    },
  ],
  scores: [
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
  ],
};

export const traceSessionMissingOptionalFixture = {
  schema_version: 'agentv.trace.v1',
  artifact_id: 'execution-trace-missing-optionals',
  created_at: '2026-06-21T10:05:00.000Z',
  eval: {
    run_id: '2026-06-21T10-05-00-000Z',
    test_id: 'missing-optionals',
    target: 'codex',
  },
  trace: {
    format: 'otlp_openinference_spans',
    trace_id: 'trace-missing',
    root_span_id: 'root-missing',
    spans: [
      {
        trace_id: 'trace-missing',
        span_id: 'root-missing',
        parent_span_id: null,
        name: 'invoke_agent codex',
        kind: 'INTERNAL',
        status: { code: 'OK' },
        attributes: {
          'agentv.test_id': 'missing-optionals',
        },
        events: [],
      },
    ],
  },
  source: {
    kind: 'agentv_run',
    path: 'index.jsonl',
    provider: 'codex',
    metadata: {
      external_trace: {
        provider: 'codex',
        session_id: 'codex-session-789',
        url: 'not-a-url',
        token: 'secret',
      },
    },
  },
};
