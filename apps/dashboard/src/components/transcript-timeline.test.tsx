import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  TranscriptTimeline,
  findAnswerPath,
  findTranscriptPath,
  parseTranscriptJsonl,
} from './TranscriptTimeline';
import {
  structuredTranscriptFiles,
  structuredTranscriptJsonl,
} from './__fixtures__/structured-transcript';

describe('TranscriptTimeline', () => {
  function renderStructuredTranscript() {
    const parsed = parseTranscriptJsonl(structuredTranscriptJsonl);
    return renderToStaticMarkup(
      <TranscriptTimeline
        entries={parsed.entries}
        finalAnswer={'{"answer":42,"source":"src/app.ts"}'}
        answerPath="final-json-answer__codex/outputs/answer.md"
        transcriptPath="final-json-answer__codex/transcript.jsonl"
        answerHref="/api/raw-answer"
        transcriptHref="/api/raw-transcript"
        transcriptDownloadHref="/api/download-transcript"
      />,
    );
  }

  it('parses canonical transcript JSONL rows in chronological order', () => {
    const parsed = parseTranscriptJsonl(structuredTranscriptJsonl);

    expect(parsed.error).toBeUndefined();
    expect(parsed.entries.map((entry) => entry.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(parsed.entries[1].tool_calls?.[0]?.tool).toBe('read_file');
    expect(parsed.entries[1].tool_calls?.[0]?.status).toBe('success');
  });

  it('rejects malformed optional tool_calls fields before rendering', () => {
    const parsed = parseTranscriptJsonl(
      JSON.stringify({
        test_id: 'final-json-answer',
        target: 'codex',
        message_index: 0,
        role: 'assistant',
        tool_calls: { id: 'call-1', tool: 'read_file' },
      }),
    );

    expect(parsed.entries).toEqual([]);
    expect(parsed.error).toBe('Line 1 is not a transcript JSONL row.');
  });

  it('finds canonical transcript and answer artifacts without selecting response.md', () => {
    expect(findTranscriptPath(structuredTranscriptFiles)).toBe(
      'final-json-answer__codex/transcript.jsonl',
    );
    expect(findAnswerPath(structuredTranscriptFiles)).toBe(
      'final-json-answer__codex/outputs/answer.md',
    );
  });

  it('keeps the first and final chronological messages expanded by default', () => {
    const html = renderStructuredTranscript();

    expect(html).toMatch(/data-testid="message-row-1" data-expanded="true"/);
    expect(html).toMatch(/data-testid="message-row-3" data-expanded="true"/);
  });

  it('keeps middle user or assistant messages collapsed by default', () => {
    const html = renderStructuredTranscript();

    expect(html).toMatch(/data-testid="message-row-2" data-expanded="false"/);
  });

  it('keeps tool calls collapsed by default', () => {
    const html = renderStructuredTranscript();

    expect(html).toMatch(/data-testid="tool-call-call-read-1" data-expanded="false"/);
  });

  it('renders expand and collapse controls for tool calls', () => {
    const html = renderStructuredTranscript();

    expect(html).toContain('Expand all tool calls');
    expect(html).toContain('Collapse all tool calls');
  });

  it('preserves joined tool result error and metadata from normalized rows', () => {
    const parsed = parseTranscriptJsonl(
      JSON.stringify({
        v: 1,
        agent: 'codex',
        type: 'assistant',
        content: [
          { type: 'text', text: 'Trying the shell.' },
          {
            type: 'tool_use',
            id: 'call-fail-1',
            name: 'bash',
            input: { command: 'false' },
            metadata: { cwd: '/tmp/agentv-fixture' },
            result: {
              status: 'error',
              output: { exit_code: 1 },
              error: { message: 'command failed' },
              metadata: { signal: 'SIGTERM' },
              duration_ms: 12,
            },
          },
        ],
      }),
    );
    const html = renderToStaticMarkup(
      <TranscriptTimeline
        entries={parsed.entries}
        transcriptPath="failing-shell__codex/transcript.jsonl"
        transcriptHref="/api/raw-transcript"
        transcriptDownloadHref="/api/download-transcript"
      />,
    );

    expect(html).toContain('command failed');
    expect(html).toContain('SIGTERM');
    expect(html).toContain('/tmp/agentv-fixture');
  });

  it('renders final answer separately from prior assistant/tool context with normalized JSONL access', () => {
    const html = renderStructuredTranscript();

    expect(html).toContain('Final answer');
    expect(html).toContain('Transcript timeline');
    expect(html).toContain('User');
    expect(html).toContain('Assistant');
    expect(html).toContain('read_file');
    expect(html).toContain('Arguments');
    expect(html).toContain('Result');
    expect(html).toContain('success');
    expect(html).toContain('Open normalized JSONL');
    expect(html).toContain('Download normalized JSONL');
    expect(html).toContain('{&quot;answer&quot;:42,&quot;source&quot;:&quot;src/app.ts&quot;}');
  });
});
