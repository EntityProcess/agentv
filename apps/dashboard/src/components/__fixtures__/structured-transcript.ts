import type { FileNode } from '~/lib/types';

export const structuredTranscriptJsonl = [
  {
    v: 1,
    agent: 'codex',
    model: 'gpt-5-codex',
    type: 'user',
    ts: '2026-06-26T12:00:00.000Z',
    content: [{ type: 'text', text: 'Inspect the workspace and return the final JSON only.' }],
  },
  {
    v: 1,
    agent: 'codex',
    model: 'gpt-5-codex',
    type: 'assistant',
    ts: '2026-06-26T12:00:01.000Z',
    input_tokens: 120,
    output_tokens: 80,
    content: [
      { type: 'text', text: 'I will inspect the file before answering.' },
      {
        type: 'tool_use',
        id: 'call-read-1',
        name: 'read_file',
        input: { path: 'src/app.ts' },
        metadata: { cwd: '/tmp/agentv-fixture' },
        result: {
          status: 'success',
          output: { ok: true, text: 'export const answer = 42;' },
          duration_ms: 32,
        },
      },
    ],
  },
  {
    v: 1,
    agent: 'codex',
    model: 'gpt-5-codex',
    type: 'assistant',
    ts: '2026-06-26T12:00:02.000Z',
    content: [{ type: 'text', text: '{"answer":42,"source":"src/app.ts"}' }],
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
