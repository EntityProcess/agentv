import { describe, expect, it } from 'vitest';
import { _internal } from '../../../src/evaluation/providers/pi-cli.js';
import { buildTraceEnvelopeFromEvaluationResult } from '../../../src/evaluation/trace-envelope.js';
import { buildTraceFromMessages } from '../../../src/evaluation/trace.js';
import type { EvaluationResult } from '../../../src/evaluation/types.js';
import { traceEnvelopeToNormalizedTranscriptJsonLines } from '../../../src/import/types.js';

const { extractMessages, extractToolCallsFromEvents } = _internal;

describe('pi-cli tool call extraction from events', () => {
  it('should extract tool calls from tool_execution_start/end events', () => {
    const events = [
      { type: 'agent_start' },
      { type: 'turn_start' },
      { type: 'message_start', message: { role: 'assistant' } },
      {
        type: 'tool_execution_start',
        toolName: 'read',
        toolCallId: 'tc-1',
        args: { path: '.agents/skills/csv-analyzer/SKILL.md' },
        timestamp: '2026-06-26T09:00:00.000Z',
      },
      {
        type: 'tool_execution_end',
        toolName: 'read',
        toolCallId: 'tc-1',
        result: 'skill content here',
        timestamp: '2026-06-26T09:00:00.025Z',
      },
      { type: 'message_end' },
      {
        type: 'turn_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      },
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Done' }] }],
      },
    ];

    const toolCalls = extractToolCallsFromEvents(events);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].tool).toBe('Read');
    expect(toolCalls[0].id).toBe('tc-1');
    expect(toolCalls[0].input).toEqual({
      path: '.agents/skills/csv-analyzer/SKILL.md',
      file_path: '.agents/skills/csv-analyzer/SKILL.md',
    });
    expect(toolCalls[0].output).toBe('skill content here');
    expect(toolCalls[0].status).toBe('ok');
    expect(toolCalls[0].durationMs).toBe(25);
  });

  it('should inject event tool calls into messages when content has no tool calls', () => {
    const events = [
      {
        type: 'tool_execution_start',
        toolName: 'read',
        toolCallId: 'tc-1',
        args: { path: '.agents/skills/csv-analyzer/SKILL.md' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        result: 'skill file contents',
      },
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'I will review this.' }] }],
      },
    ];

    const messages = extractMessages(events);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].toolCalls).toBeDefined();
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls?.[0].tool).toBe('Read');
    expect(messages[0].toolCalls?.[0].input).toEqual({
      path: '.agents/skills/csv-analyzer/SKILL.md',
      file_path: '.agents/skills/csv-analyzer/SKILL.md',
    });
  });

  it('should join event tool results into existing message tool calls without duplicating', () => {
    const events = [
      {
        type: 'tool_execution_start',
        toolName: 'read',
        toolCallId: 'tc-1',
        args: { path: '.agents/skills/csv-analyzer/SKILL.md' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        result: 'content',
      },
      {
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Review' },
              {
                type: 'tool_use',
                name: 'read',
                id: 'tc-1',
                input: { path: '.agents/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      },
    ];

    const messages = extractMessages(events);

    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls?.[0]).toMatchObject({
      tool: 'Read',
      id: 'tc-1',
      input: {
        path: '.agents/skills/csv-analyzer/SKILL.md',
        file_path: '.agents/skills/csv-analyzer/SKILL.md',
      },
      output: 'content',
      status: 'ok',
    });
  });

  it('emits normalized transcript tool_use.result for Pi event result payloads', () => {
    const events = [
      {
        type: 'tool_execution_start',
        toolName: 'bash',
        toolCallId: 'tc-bash',
        args: { command: 'cat package.json' },
        timestamp: '2026-06-26T09:00:00.000Z',
      },
      {
        type: 'tool_execution_end',
        toolName: 'bash',
        toolCallId: 'tc-bash',
        result: { stdout: '{"scripts":{"test":"bun test"}}' },
        timestamp: '2026-06-26T09:00:00.040Z',
      },
      {
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Checking scripts.' },
              {
                type: 'tool_use',
                name: 'bash',
                id: 'tc-bash',
                input: { command: 'cat package.json' },
              },
            ],
          },
        ],
      },
    ];

    const output = extractMessages(events);
    const trace = buildTraceFromMessages({
      input: [{ role: 'user', content: 'Check the package script.' }],
      output,
      finalOutput: 'Checking scripts.',
      target: 'pi-cli',
      testId: 'pi-tool-result-normalized',
      startTime: '2026-06-26T09:00:00.000Z',
      endTime: '2026-06-26T09:00:00.040Z',
    });
    const result: EvaluationResult = {
      timestamp: '2026-06-26T09:00:00.000Z',
      testId: 'pi-tool-result-normalized',
      suite: 'pi-cli',
      score: 1,
      assertions: [{ text: 'ok', passed: true }],
      target: 'pi-cli',
      durationMs: 40,
      startTime: '2026-06-26T09:00:00.000Z',
      endTime: '2026-06-26T09:00:00.040Z',
      input: [{ role: 'user', content: 'Check the package script.' }],
      output: 'Checking scripts.',
      executionStatus: 'ok',
      trace,
    };
    const envelope = buildTraceEnvelopeFromEvaluationResult(result, {
      source: {
        kind: 'pi_session',
        provider: 'pi',
        format: 'jsonl',
      },
      capture: { content: 'full', redactionLevel: 'none', redactedFields: [] },
    });

    const rows = traceEnvelopeToNormalizedTranscriptJsonLines(envelope);
    const assistant = rows.find((row) => row.type === 'assistant');
    const toolUse = assistant?.content.find((block) => block.type === 'tool_use');

    expect(toolUse).toMatchObject({
      type: 'tool_use',
      id: 'tc-bash',
      name: 'Bash',
      input: { command: 'cat package.json' },
      result: {
        status: 'success',
        output: { stdout: '{"scripts":{"test":"bun test"}}' },
        duration_ms: 40,
      },
    });
  });

  it('should handle multiple tool execution events', () => {
    const events = [
      {
        type: 'tool_execution_start',
        toolName: 'read',
        toolCallId: 'tc-1',
        args: { path: '.agents/skills/csv-analyzer/SKILL.md' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        result: 'skill content',
      },
      {
        type: 'tool_execution_start',
        toolName: 'bash',
        toolCallId: 'tc-2',
        args: { command: 'ls' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-2',
        result: 'file list',
      },
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Done' }] }],
      },
    ];

    const messages = extractMessages(events);

    expect(messages[0].toolCalls).toHaveLength(2);
    expect(messages[0].toolCalls?.[0].tool).toBe('Read');
    expect(messages[0].toolCalls?.[1].tool).toBe('Bash');
  });

  it('should create synthetic assistant message when no assistant message exists', () => {
    const events = [
      {
        type: 'tool_execution_start',
        toolName: 'read',
        toolCallId: 'tc-1',
        args: { path: '.agents/skills/csv-analyzer/SKILL.md' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        result: 'content',
      },
      {
        type: 'agent_end',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Review this' }] }],
      },
    ];

    const messages = extractMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].toolCalls).toHaveLength(1);
    expect(messages[1].toolCalls?.[0].tool).toBe('Read');
  });

  it('should fall back to turn_end events and still inject tool calls', () => {
    const events = [
      {
        type: 'tool_execution_start',
        toolName: 'read',
        toolCallId: 'tc-1',
        args: { path: '.agents/skills/csv-analyzer/SKILL.md' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        result: 'content',
      },
      {
        type: 'turn_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Response' }] },
      },
    ];

    const messages = extractMessages(events);

    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls?.[0].tool).toBe('Read');
  });

  it('should handle tool_call type in message content', () => {
    const events = [
      {
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_call',
                name: 'read',
                id: 'tc-1',
                arguments: { path: '.agents/skills/csv-analyzer/SKILL.md' },
              },
            ],
          },
        ],
      },
    ];

    const messages = extractMessages(events);

    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[0].toolCalls?.[0].tool).toBe('Read');
    expect(messages[0].toolCalls?.[0].input).toEqual({
      path: '.agents/skills/csv-analyzer/SKILL.md',
      file_path: '.agents/skills/csv-analyzer/SKILL.md',
    });
  });
});
