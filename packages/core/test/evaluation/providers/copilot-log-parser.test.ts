import { describe, expect, it } from 'vitest';
import {
  parseCopilotEvents,
  type ParsedCopilotSession,
} from '../../../src/evaluation/providers/copilot-log-parser.js';

function eventLine(type: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, ...data });
}

describe('parseCopilotEvents', () => {
  it('parses session.start into metadata', () => {
    const lines = [
      eventLine('session.start', {
        sessionId: 'abc-123',
        selectedModel: 'gpt-4o',
        context: { cwd: '/projects/app', repository: 'org/repo' },
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.meta.sessionId).toBe('abc-123');
    expect(result.meta.model).toBe('gpt-4o');
    expect(result.meta.cwd).toBe('/projects/app');
    expect(result.meta.repository).toBe('org/repo');
  });

  it('parses user.message into user Message', () => {
    const lines = [
      eventLine('user.message', { content: 'Hello agent' }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('Hello agent');
  });

  it('parses assistant.message into assistant Message', () => {
    const lines = [
      eventLine('assistant.message', {
        content: 'I will help you',
        toolRequests: [
          { toolName: 'Read File', arguments: { file_path: '/src/index.ts' } },
        ],
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content).toBe('I will help you');
    expect(result.messages[0].toolCalls).toHaveLength(1);
    expect(result.messages[0].toolCalls![0].tool).toBe('Read File');
    expect(result.messages[0].toolCalls![0].input).toEqual({ file_path: '/src/index.ts' });
  });

  it('parses skill.invoked as ToolCall with tool=Skill', () => {
    const lines = [
      eventLine('skill.invoked', {
        name: 'csv-analyzer',
        path: '/skills/csv-analyzer/SKILL.md',
        content: 'skill content',
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    const assistantMsg = result.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls).toHaveLength(1);
    expect(assistantMsg!.toolCalls![0].tool).toBe('Skill');
    expect(assistantMsg!.toolCalls![0].input).toEqual({ skill: 'csv-analyzer' });
  });

  it('pairs tool.execution_start with tool.execution_complete', () => {
    const lines = [
      eventLine('tool.execution_start', {
        toolCallId: 'tc-1',
        toolName: 'Read File',
        arguments: { file_path: '/src/app.ts' },
      }),
      eventLine('tool.execution_complete', {
        toolCallId: 'tc-1',
        success: true,
        result: 'file contents',
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    const assistantMsg = result.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls).toHaveLength(1);
    expect(assistantMsg!.toolCalls![0].tool).toBe('Read File');
    expect(assistantMsg!.toolCalls![0].output).toBe('file contents');
  });

  it('extracts token usage from assistant.usage', () => {
    const lines = [
      eventLine('assistant.usage', {
        inputTokens: 1000,
        outputTokens: 500,
        model: 'gpt-4o',
        cost: 0.025,
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.tokenUsage).toEqual({ input: 1000, output: 500 });
    expect(result.costUsd).toBe(0.025);
  });

  it('computes durationMs from session.start to session.shutdown', () => {
    const lines = [
      eventLine('session.start', {
        sessionId: 's1',
        selectedModel: 'gpt-4o',
        context: { cwd: '/app' },
        timestamp: '2026-03-25T10:00:00.000Z',
      }),
      eventLine('session.shutdown', {
        timestamp: '2026-03-25T10:01:30.000Z',
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.durationMs).toBe(90_000);
  });

  it('handles empty input gracefully', () => {
    const result = parseCopilotEvents('');
    expect(result.messages).toEqual([]);
    expect(result.meta.sessionId).toBe('');
    expect(result.meta.model).toBe('');
    expect(result.meta.cwd).toBe('');
  });

  it('skips malformed JSON lines', () => {
    const lines = [
      'not-json',
      eventLine('user.message', { content: 'valid line' }),
      '{broken',
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('valid line');
  });
});
