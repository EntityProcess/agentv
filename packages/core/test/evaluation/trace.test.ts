import { describe, expect, it } from 'bun:test';

import {
  type TraceEvent,
  computeTraceSummary,
  extractTraceFromMessages,
  isTraceEvent,
  isTraceEventType,
} from '../../src/evaluation/trace.js';

describe('computeTraceSummary', () => {
  it('returns correct summary for trace with various events', () => {
    const trace: TraceEvent[] = [
      { type: 'model_step', timestamp: '2024-01-01T00:00:00Z', text: 'Thinking...' },
      {
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:01Z',
        id: 'call-1',
        name: 'getWeather',
        input: { city: 'NYC' },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:02Z',
        id: 'call-1',
        name: 'getWeather',
        output: '72°F',
      },
      {
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:03Z',
        id: 'call-2',
        name: 'getTime',
        input: { tz: 'EST' },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:04Z',
        id: 'call-2',
        name: 'getTime',
        output: '14:30',
      },
      {
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:05Z',
        id: 'call-3',
        name: 'getWeather',
        input: { city: 'LA' },
      },
      {
        type: 'tool_result',
        timestamp: '2024-01-01T00:00:06Z',
        id: 'call-3',
        name: 'getWeather',
        output: '85°F',
      },
      { type: 'message', timestamp: '2024-01-01T00:00:07Z', text: 'Done!' },
    ];

    const summary = computeTraceSummary(trace);

    expect(summary.eventCount).toBe(8);
    expect(summary.toolNames).toEqual(['getTime', 'getWeather']); // sorted alphabetically
    expect(summary.toolCallsByName).toEqual({ getWeather: 2, getTime: 1 });
    expect(summary.errorCount).toBe(0);
  });

  it('returns correct summary for empty trace', () => {
    const summary = computeTraceSummary([]);

    expect(summary.eventCount).toBe(0);
    expect(summary.toolNames).toEqual([]);
    expect(summary.toolCallsByName).toEqual({});
    expect(summary.errorCount).toBe(0);
  });

  it('counts error events correctly', () => {
    const trace: TraceEvent[] = [
      { type: 'tool_call', timestamp: '2024-01-01T00:00:00Z', name: 'search', input: {} },
      { type: 'error', timestamp: '2024-01-01T00:00:01Z', text: 'Tool failed' },
      { type: 'tool_call', timestamp: '2024-01-01T00:00:02Z', name: 'search', input: {} },
      { type: 'error', timestamp: '2024-01-01T00:00:03Z', text: 'Tool failed again' },
    ];

    const summary = computeTraceSummary(trace);

    expect(summary.errorCount).toBe(2);
    expect(summary.toolCallsByName).toEqual({ search: 2 });
  });

  it('sorts toolNames alphabetically', () => {
    const trace: TraceEvent[] = [
      { type: 'tool_call', timestamp: '2024-01-01T00:00:00Z', name: 'zeta' },
      { type: 'tool_call', timestamp: '2024-01-01T00:00:01Z', name: 'alpha' },
      { type: 'tool_call', timestamp: '2024-01-01T00:00:02Z', name: 'beta' },
    ];

    const summary = computeTraceSummary(trace);

    expect(summary.toolNames).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('ignores tool_call events without name', () => {
    const trace: TraceEvent[] = [
      { type: 'tool_call', timestamp: '2024-01-01T00:00:00Z', name: 'validTool' },
      { type: 'tool_call', timestamp: '2024-01-01T00:00:01Z' }, // no name
      { type: 'tool_call', timestamp: '2024-01-01T00:00:02Z', name: '' }, // empty name (treated as falsy)
    ];

    const summary = computeTraceSummary(trace);

    expect(summary.toolNames).toEqual(['validTool']);
    expect(summary.toolCallsByName).toEqual({ validTool: 1 });
  });
});

describe('isTraceEventType', () => {
  it('returns true for valid event types', () => {
    expect(isTraceEventType('model_step')).toBe(true);
    expect(isTraceEventType('tool_call')).toBe(true);
    expect(isTraceEventType('tool_result')).toBe(true);
    expect(isTraceEventType('message')).toBe(true);
    expect(isTraceEventType('error')).toBe(true);
  });

  it('returns false for invalid event types', () => {
    expect(isTraceEventType('invalid')).toBe(false);
    expect(isTraceEventType('')).toBe(false);
    expect(isTraceEventType(null)).toBe(false);
    expect(isTraceEventType(undefined)).toBe(false);
    expect(isTraceEventType(123)).toBe(false);
  });
});

describe('isTraceEvent', () => {
  it('returns true for valid TraceEvent objects', () => {
    expect(isTraceEvent({ type: 'tool_call', timestamp: '2024-01-01T00:00:00Z' })).toBe(true);
    expect(
      isTraceEvent({
        type: 'tool_call',
        timestamp: '2024-01-01T00:00:00Z',
        id: 'call-1',
        name: 'myTool',
        input: { key: 'value' },
      }),
    ).toBe(true);
  });

  it('returns true for TraceEvent without timestamp (timestamp is optional)', () => {
    expect(isTraceEvent({ type: 'tool_call' })).toBe(true);
    expect(isTraceEvent({ type: 'tool_call', name: 'search' })).toBe(true);
  });

  it('returns false for invalid TraceEvent objects', () => {
    expect(isTraceEvent(null)).toBe(false);
    expect(isTraceEvent(undefined)).toBe(false);
    expect(isTraceEvent({})).toBe(false);
    expect(isTraceEvent({ timestamp: '2024-01-01T00:00:00Z' })).toBe(false); // missing type
    expect(isTraceEvent({ type: 'invalid', timestamp: '2024-01-01T00:00:00Z' })).toBe(false);
    expect(isTraceEvent({ type: 'tool_call', timestamp: 123 })).toBe(false); // timestamp wrong type
  });
});

describe('extractTraceFromMessages', () => {
  it('extracts tool calls from output messages', () => {
    const messages = [
      {
        role: 'assistant',
        toolCalls: [
          { tool: 'search', input: { query: 'hello' }, output: 'result1' },
          { tool: 'analyze', input: { data: 123 } },
        ],
      },
    ];

    const trace = extractTraceFromMessages(messages);

    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual({
      type: 'tool_call',
      name: 'search',
      input: { query: 'hello' },
      output: 'result1',
    });
    expect(trace[1]).toEqual({
      type: 'tool_call',
      name: 'analyze',
      input: { data: 123 },
      output: undefined,
    });
  });

  it('returns empty array for messages without tool calls', () => {
    const messages = [
      { role: 'assistant', content: 'Hello there!' },
      { role: 'user', content: 'Hi!' },
    ];

    const trace = extractTraceFromMessages(messages);

    expect(trace).toEqual([]);
  });

  it('returns empty array for empty messages', () => {
    const trace = extractTraceFromMessages([]);
    expect(trace).toEqual([]);
  });

  it('handles messages with empty toolCalls array', () => {
    const messages = [{ role: 'assistant', toolCalls: [] }];

    const trace = extractTraceFromMessages(messages);

    expect(trace).toEqual([]);
  });

  it('preserves order of tool calls across multiple messages', () => {
    const messages = [
      {
        role: 'assistant',
        toolCalls: [{ tool: 'first', input: {} }],
      },
      {
        role: 'assistant',
        content: 'Intermediate message',
        toolCalls: [
          { tool: 'second', input: {} },
          { tool: 'third', input: {} },
        ],
      },
    ];

    const trace = extractTraceFromMessages(messages);

    expect(trace).toHaveLength(3);
    expect(trace[0].name).toBe('first');
    expect(trace[1].name).toBe('second');
    expect(trace[2].name).toBe('third');
  });

  it('handles mixed messages with and without tool calls', () => {
    const messages = [
      { role: 'user', content: 'Do something' },
      { role: 'assistant', toolCalls: [{ tool: 'doThing', input: { x: 1 } }] },
      { role: 'assistant', content: 'Done!' },
    ];

    const trace = extractTraceFromMessages(messages);

    expect(trace).toHaveLength(1);
    expect(trace[0].name).toBe('doThing');
  });
});
