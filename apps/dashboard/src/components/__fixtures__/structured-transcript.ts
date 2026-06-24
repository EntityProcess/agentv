import type { FileNode } from '~/lib/types';

export const structuredTranscriptJsonl = [
  {
    schema_version: 'agentv.transcript.v1',
    test_id: 'final-json-answer',
    target: 'codex',
    message_index: 0,
    role: 'user',
    content: 'Inspect the workspace and return the final JSON only.',
    capture: { content: 'full', redaction_level: 'none', redacted_fields: [] },
    source: {
      kind: 'agentv_run',
      provider: 'codex',
      session_id: 'session-123',
      model: 'gpt-5-codex',
    },
    transcript_token_usage: { input: 120, output: 80 },
    transcript_duration_ms: 2450,
    transcript_cost_usd: 0.0123,
  },
  {
    schema_version: 'agentv.transcript.v1',
    test_id: 'final-json-answer',
    target: 'codex',
    message_index: 1,
    role: 'assistant',
    content: 'I will inspect the file before answering.',
    tool_calls: [
      {
        id: 'call-read-1',
        tool: 'read_file',
        input: { path: 'src/app.ts' },
        duration_ms: 32,
        metadata: { cwd: '/tmp/agentv-fixture' },
      },
    ],
    capture: { content: 'full', redaction_level: 'none', redacted_fields: [] },
    source: {
      kind: 'agentv_run',
      provider: 'codex',
      session_id: 'session-123',
      model: 'gpt-5-codex',
    },
  },
  {
    schema_version: 'agentv.transcript.v1',
    test_id: 'final-json-answer',
    target: 'codex',
    message_index: 2,
    role: 'tool',
    name: 'read_file',
    content: { ok: true, text: 'export const answer = 42;' },
    duration_ms: 32,
    capture: { content: 'full', redaction_level: 'none', redacted_fields: [] },
    source: {
      kind: 'agentv_run',
      provider: 'codex',
      session_id: 'session-123',
      model: 'gpt-5-codex',
    },
  },
  {
    schema_version: 'agentv.transcript.v1',
    test_id: 'final-json-answer',
    target: 'codex',
    message_index: 3,
    role: 'assistant',
    content: '{"answer":42,"source":"src/app.ts"}',
    capture: { content: 'full', redaction_level: 'none', redacted_fields: [] },
    source: {
      kind: 'agentv_run',
      provider: 'codex',
      session_id: 'session-123',
      model: 'gpt-5-codex',
    },
  },
]
  .map((line) => JSON.stringify(line))
  .join('\n');

export const structuredTranscriptFiles: FileNode[] = [
  {
    name: 'final-json-answer__codex',
    path: 'final-json-answer__codex',
    type: 'dir',
    children: [
      { name: 'grading.json', path: 'final-json-answer__codex/grading.json', type: 'file' },
      { name: 'answer.md', path: 'final-json-answer__codex/outputs/answer.md', type: 'file' },
      {
        name: 'outputs',
        path: 'final-json-answer__codex/outputs',
        type: 'dir',
        children: [
          {
            name: 'answer.md',
            path: 'final-json-answer__codex/outputs/answer.md',
            type: 'file',
          },
          {
            name: 'transcript.jsonl',
            path: 'final-json-answer__codex/transcript.jsonl',
            type: 'file',
          },
          {
            name: 'response.md',
            path: 'final-json-answer__codex/outputs/response.md',
            type: 'file',
          },
        ],
      },
    ],
  },
];
