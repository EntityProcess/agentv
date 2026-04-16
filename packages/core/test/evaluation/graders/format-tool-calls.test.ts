import { describe, expect, it } from 'vitest';
import { formatToolCalls } from '../../../src/evaluation/graders/format-tool-calls.js';
import type { Message } from '../../../src/evaluation/providers/types.js';

describe('formatToolCalls', () => {
  it('returns empty string for undefined output', () => {
    expect(formatToolCalls(undefined)).toBe('');
  });

  it('returns empty string for empty messages array', () => {
    expect(formatToolCalls([])).toBe('');
  });

  it('returns empty string when no messages have tool calls', () => {
    const messages: Message[] = [
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Hi' },
    ];
    expect(formatToolCalls(messages)).toBe('');
  });

  it('formats Skill tool calls with skill name', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'Skill', input: { skill: 'commit' } }],
      },
    ];
    expect(formatToolCalls(messages)).toBe('- Skill: commit');
  });

  it('formats Read/Write/Edit tool calls with file_path', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [
          { tool: 'Read', input: { file_path: '/src/index.ts' } },
          { tool: 'Write', input: { file_path: '/src/output.ts', content: '...' } },
          { tool: 'Edit', input: { file_path: '/src/edit.ts', old_string: 'a', new_string: 'b' } },
        ],
      },
    ];
    const result = formatToolCalls(messages);
    expect(result).toBe('- Read: /src/index.ts\n- Write: /src/output.ts\n- Edit: /src/edit.ts');
  });

  it('formats Bash tool calls with command', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'Bash', input: { command: 'npm test' } }],
      },
    ];
    expect(formatToolCalls(messages)).toBe('- Bash: npm test');
  });

  it('formats Grep/Glob tool calls with pattern', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [
          { tool: 'Grep', input: { pattern: 'TODO', path: '/src' } },
          { tool: 'Glob', input: { pattern: '**/*.ts' } },
        ],
      },
    ];
    expect(formatToolCalls(messages)).toBe('- Grep: TODO\n- Glob: **/*.ts');
  });

  it('formats mixed tool calls across multiple messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [
          { tool: 'Read', input: { file_path: '/package.json' } },
          { tool: 'Bash', input: { command: 'ls -la' } },
        ],
      },
      { role: 'user', content: 'ok' },
      {
        role: 'assistant',
        toolCalls: [{ tool: 'Skill', input: { skill: 'review-pr' } }],
      },
    ];
    const result = formatToolCalls(messages);
    expect(result).toBe('- Read: /package.json\n- Bash: ls -la\n- Skill: review-pr');
  });

  it('falls back to first short string field for unknown tools', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'CustomTool', input: { query: 'find me something' } }],
      },
    ];
    expect(formatToolCalls(messages)).toBe('- CustomTool: find me something');
  });

  it('shows tool name only when input is empty', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'SomeTool', input: {} }],
      },
    ];
    expect(formatToolCalls(messages)).toBe('- SomeTool');
  });

  it('shows tool name only when input is undefined', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'SomeTool' }],
      },
    ];
    expect(formatToolCalls(messages)).toBe('- SomeTool');
  });

  it('truncates long input values', () => {
    const longCommand = 'x'.repeat(200);
    const messages: Message[] = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'Bash', input: { command: longCommand } }],
      },
    ];
    const result = formatToolCalls(messages);
    expect(result).toContain('- Bash: ');
    // 120 chars + ellipsis
    expect(result.length).toBeLessThan(200);
  });
});
