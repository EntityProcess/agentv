import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/evaluation/providers/types.js';

// Extract and test the groupMessagesIntoTurns logic directly
interface Turn {
  messages: Message[];
}

function groupMessagesIntoTurns(messages: readonly Message[]): Turn[] {
  const turns: Turn[] = [];
  let current: Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'user' && current.length > 0) {
      turns.push({ messages: current });
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) turns.push({ messages: current });
  return turns;
}

describe('groupMessagesIntoTurns', () => {
  it('returns a single turn for single-turn conversation', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages).toHaveLength(2);
    expect(turns[0].messages[0].role).toBe('user');
    expect(turns[0].messages[1].role).toBe('assistant');
  });

  it('splits multi-turn conversation at each user message', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Turn 2' },
      { role: 'assistant', content: 'Response 2' },
      { role: 'user', content: 'Turn 3' },
      { role: 'assistant', content: 'Response 3' },
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(3);
    expect(turns[0].messages).toEqual([
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'Response 1' },
    ]);
    expect(turns[1].messages).toEqual([
      { role: 'user', content: 'Turn 2' },
      { role: 'assistant', content: 'Response 2' },
    ]);
    expect(turns[2].messages).toEqual([
      { role: 'user', content: 'Turn 3' },
      { role: 'assistant', content: 'Response 3' },
    ]);
  });

  it('handles assistant-only messages (no user prefix)', () => {
    const messages: Message[] = [
      { role: 'assistant', content: 'System greeting' },
      { role: 'assistant', content: 'Another message' },
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0].messages).toHaveLength(2);
  });

  it('handles empty input', () => {
    const turns = groupMessagesIntoTurns([]);
    expect(turns).toHaveLength(0);
  });

  it('handles user message with tool calls before next user message', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Do something' },
      { role: 'assistant', content: 'OK', toolCalls: [{ tool: 'search', input: 'query' }] },
      { role: 'tool', content: 'result' },
      { role: 'assistant', content: 'Here is the answer' },
      { role: 'user', content: 'Follow up' },
      { role: 'assistant', content: 'Sure' },
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(2);
    expect(turns[0].messages).toHaveLength(4);
    expect(turns[1].messages).toHaveLength(2);
  });
});

describe('OtelTraceExporter groupTurns integration', () => {
  it('OtelExportOptions accepts groupTurns field', async () => {
    const { OtelTraceExporter } = await import('../../src/observability/otel-exporter.js');
    // Verify the exporter can be constructed with groupTurns option
    const exporter = new OtelTraceExporter({
      endpoint: 'http://localhost:4318/v1/traces',
      groupTurns: true,
    });
    expect(exporter).toBeDefined();
  });

  it('OtelExportOptions works without groupTurns (default behavior)', async () => {
    const { OtelTraceExporter } = await import('../../src/observability/otel-exporter.js');
    const exporter = new OtelTraceExporter({
      endpoint: 'http://localhost:4318/v1/traces',
    });
    expect(exporter).toBeDefined();
  });
});
