import { describe, expect, it } from 'vitest';
import { _internal } from '../../../src/evaluation/providers/pi-cli.js';

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
      },
      {
        type: 'tool_execution_end',
        toolName: 'read',
        toolCallId: 'tc-1',
        result: 'skill content here',
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
    expect(toolCalls[0].tool).toBe('read');
    expect(toolCalls[0].id).toBe('tc-1');
    expect(toolCalls[0].input).toEqual({ path: '.agents/skills/csv-analyzer/SKILL.md' });
    expect(toolCalls[0].output).toBe('skill content here');
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
    expect(messages[0].toolCalls?.[0].tool).toBe('read');
    expect(messages[0].toolCalls?.[0].input).toEqual({
      path: '.agents/skills/csv-analyzer/SKILL.md',
    });
  });

  it('should not duplicate tool calls already present in messages', () => {
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
    expect(messages[0].toolCalls?.[0].tool).toBe('read');
    expect(messages[0].toolCalls?.[1].tool).toBe('bash');
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
    expect(messages[1].toolCalls?.[0].tool).toBe('read');
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
    expect(messages[0].toolCalls?.[0].tool).toBe('read');
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
    expect(messages[0].toolCalls?.[0].tool).toBe('read');
    expect(messages[0].toolCalls?.[0].input).toEqual({
      path: '.agents/skills/csv-analyzer/SKILL.md',
    });
  });

  it('should recover assistant text from message_update deltas when agent_end content is empty', () => {
    const events = [
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: '2 + 2',
          partial: { role: 'assistant', content: [{ type: 'text', text: '2 + 2' }] },
        },
      },
      {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: ' = 4',
          partial: { role: 'assistant', content: [{ type: 'text', text: '2 + 2 = 4' }] },
        },
      },
      {
        type: 'agent_end',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] },
          { role: 'assistant', content: [] },
        ],
      },
    ];

    const messages = extractMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '2 + 2 = 4',
    });
  });
});
