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
  it('parses canonical transcript JSONL rows in chronological order', () => {
    const parsed = parseTranscriptJsonl(structuredTranscriptJsonl);

    expect(parsed.error).toBeUndefined();
    expect(parsed.entries.map((entry) => entry.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(parsed.entries[1].tool_calls?.[0]?.tool).toBe('read_file');
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
      'final-json-answer__codex/outputs/transcript.jsonl',
    );
    expect(findAnswerPath(structuredTranscriptFiles)).toBe(
      'final-json-answer__codex/outputs/answer.md',
    );
  });

  it('renders final answer separately from prior assistant/tool context with raw JSONL access', () => {
    const parsed = parseTranscriptJsonl(structuredTranscriptJsonl);
    const html = renderToStaticMarkup(
      <TranscriptTimeline
        entries={parsed.entries}
        finalAnswer={'{"answer":42,"source":"src/app.ts"}'}
        answerPath="final-json-answer__codex/outputs/answer.md"
        transcriptPath="final-json-answer__codex/outputs/transcript.jsonl"
        answerHref="/api/raw-answer"
        transcriptHref="/api/raw-transcript"
        transcriptDownloadHref="/api/download-transcript"
      />,
    );

    expect(html).toContain('Final answer');
    expect(html).toContain('Transcript timeline');
    expect(html).toContain('User');
    expect(html).toContain('Assistant');
    expect(html).toContain('Tool result');
    expect(html).toContain('read_file');
    expect(html).toContain('Arguments');
    expect(html).toContain('Result');
    expect(html).toContain('Open raw JSONL');
    expect(html).toContain('Download JSONL');
    expect(html).toContain('{&quot;answer&quot;:42,&quot;source&quot;:&quot;src/app.ts&quot;}');
  });
});
