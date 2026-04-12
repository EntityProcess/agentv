import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CopilotStreamLogger } from '../../../src/evaluation/providers/copilot-utils.js';

const noopSummarize = (_type: string, _data: unknown): string | undefined => undefined;

describe('CopilotStreamLogger', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'copilot-stream-logger-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes summary events as separate lines', async () => {
    const filePath = path.join(tempDir, 'test.log');
    const summarize = (type: string, _data: unknown) =>
      type === 'tool_call' ? 'read_file' : undefined;

    const logger = await CopilotStreamLogger.create(
      { filePath, targetName: 'test', format: 'summary', headerLabel: 'Test' },
      summarize,
    );
    logger.handleEvent('tool_call', {});
    logger.handleEvent('tool_call', {});
    await logger.close();

    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.includes('[tool_call]'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/\[tool_call\] read_file/);
  });

  it('buffers chunk events and flushes as single [assistant_message] line on non-chunk event', async () => {
    const filePath = path.join(tempDir, 'test.log');
    const summarize = (type: string, _data: unknown) =>
      type === 'tool_call' ? 'read_file' : undefined;
    const chunkExtractor = (type: string, data: unknown): string | null | undefined => {
      if (type !== 'agent_message_chunk') return undefined;
      const d = data as Record<string, unknown>;
      const content = d?.content as Record<string, unknown> | undefined;
      return content?.type === 'text' && typeof content.text === 'string'
        ? content.text
        : undefined;
    };

    const logger = await CopilotStreamLogger.create(
      { filePath, targetName: 'test', format: 'summary', headerLabel: 'Test', chunkExtractor },
      summarize,
    );

    // Three chunks — should NOT produce three log lines
    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: 'Hello' } });
    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: ' world' } });
    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: '!' } });
    // Non-chunk event triggers flush
    logger.handleEvent('tool_call', {});
    await logger.close();

    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());

    // No raw chunk lines
    expect(lines.some((l) => l.includes('[agent_message_chunk]'))).toBe(false);
    // One consolidated assistant_message line with full text
    const msgLine = lines.find((l) => l.includes('[assistant_message]'));
    expect(msgLine).toBeDefined();
    expect(msgLine).toMatch(/Hello world!/);
    // tool_call still emitted
    expect(lines.some((l) => l.includes('[tool_call]'))).toBe(true);
  });

  it('flushes remaining buffered text on close', async () => {
    const filePath = path.join(tempDir, 'test.log');
    const chunkExtractor = (type: string, data: unknown): string | null | undefined => {
      if (type !== 'agent_message_chunk') return undefined;
      const d = data as Record<string, unknown>;
      const content = d?.content as Record<string, unknown> | undefined;
      return content?.type === 'text' && typeof content.text === 'string'
        ? content.text
        : undefined;
    };

    const logger = await CopilotStreamLogger.create(
      { filePath, targetName: 'test', format: 'summary', headerLabel: 'Test', chunkExtractor },
      noopSummarize,
    );

    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: 'Final answer' } });
    // close() without any subsequent non-chunk event
    await logger.close();

    const content = await readFile(filePath, 'utf8');
    expect(content).toMatch(/\[assistant_message\] Final answer/);
  });

  it('consolidates chunk events in json format as single assistant_message entry', async () => {
    const filePath = path.join(tempDir, 'test.log');
    const chunkExtractor = (type: string, data: unknown): string | null | undefined => {
      if (type !== 'agent_message_chunk') return undefined;
      const d = data as Record<string, unknown>;
      const content = d?.content as Record<string, unknown> | undefined;
      return content?.type === 'text' && typeof content.text === 'string'
        ? content.text
        : undefined;
    };

    const logger = await CopilotStreamLogger.create(
      { filePath, targetName: 'test', format: 'json', headerLabel: 'Test', chunkExtractor },
      noopSummarize,
    );

    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: 'chunk1' } });
    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: 'chunk2' } });
    logger.handleEvent('tool_call', { title: 'read_file' });
    await logger.close();

    const content = await readFile(filePath, 'utf8');
    const jsonLines = content
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l));
    // No raw chunk events — consolidated into one assistant_message
    expect(jsonLines.filter((e) => e.event === 'agent_message_chunk')).toHaveLength(0);
    const msg = jsonLines.find((e) => e.event === 'assistant_message');
    expect(msg).toBeDefined();
    expect(msg.data.content).toBe('chunk1chunk2');
    // Non-chunk event still emitted
    expect(jsonLines.find((e) => e.event === 'tool_call')).toBeDefined();
  });

  it('handles chunk events with no extractable text gracefully', async () => {
    const filePath = path.join(tempDir, 'test.log');
    const chunkExtractor = (type: string, _data: unknown): string | null | undefined =>
      type === 'agent_message_chunk' ? undefined : undefined;

    const logger = await CopilotStreamLogger.create(
      { filePath, targetName: 'test', format: 'summary', headerLabel: 'Test', chunkExtractor },
      noopSummarize,
    );

    // Chunks with no extractable text are silently skipped (chunkExtractor returns undefined
    // meaning "not a chunk" — treated as non-chunk events, summarize returns undefined, no output)
    logger.handleEvent('agent_message_chunk', { content: { type: 'image' } });
    await logger.close();

    const content = await readFile(filePath, 'utf8');
    expect(content).not.toMatch(/\[assistant_message\]/);
  });

  it('null return from chunkExtractor resets buffer without emitting (handles pre-thinking streaming)', async () => {
    const filePath = path.join(tempDir, 'test.log');
    // Simulates Copilot ACP: chunks → thought_chunks (reset) → chunks (final)
    const chunkExtractor = (type: string, data: unknown): string | null | undefined => {
      if (type === 'agent_thought_chunk') return null;
      if (type !== 'agent_message_chunk') return undefined;
      const d = data as Record<string, unknown>;
      const content = d?.content as Record<string, unknown> | undefined;
      return content?.type === 'text' && typeof content.text === 'string'
        ? content.text
        : undefined;
    };

    const logger = await CopilotStreamLogger.create(
      { filePath, targetName: 'test', format: 'summary', headerLabel: 'Test', chunkExtractor },
      noopSummarize,
    );

    // First pass: streaming preview (should be discarded)
    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: 'Hi' } });
    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: ' there.' } });
    // Extended thinking: resets the buffer
    logger.handleEvent('agent_thought_chunk', {});
    logger.handleEvent('agent_thought_chunk', {});
    // Second pass: final response
    logger.handleEvent('agent_message_chunk', { content: { type: 'text', text: 'Hi there.' } });
    await logger.close();

    const content = await readFile(filePath, 'utf8');
    const msgLines = content.split('\n').filter((l) => l.includes('[assistant_message]'));
    // Only one consolidated line — the final response, not the preview
    expect(msgLines).toHaveLength(1);
    expect(msgLines[0]).toMatch(/\[assistant_message\] Hi there\.$/);
  });
});
