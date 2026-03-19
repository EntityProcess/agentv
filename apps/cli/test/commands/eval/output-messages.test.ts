import { describe, expect, it } from 'bun:test';

import { trimOutputMessages } from '../../../src/commands/eval/run-eval.js';

const makeMessages = () => [
  { role: 'user', content: 'Hello', startTime: '2024-01-01T00:00:00Z', durationMs: 10 },
  {
    role: 'assistant',
    content: 'Hi there',
    toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }],
    startTime: '2024-01-01T00:00:01Z',
  },
  { role: 'tool', content: 'file contents', name: 'read', durationMs: 50 },
  { role: 'assistant', content: 'Done!', startTime: '2024-01-01T00:00:02Z', durationMs: 100 },
];

describe('trimOutputMessages', () => {
  describe('default (outputMessages = 1)', () => {
    it('returns only the last assistant message trimmed to { role, content }', () => {
      const result = trimOutputMessages(makeMessages() as any, 1);
      expect(result).toEqual([{ role: 'assistant', content: 'Done!' }]);
    });

    it('returns empty array when no assistant message exists', () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const result = trimOutputMessages(messages as any, 1);
      expect(result).toEqual([]);
    });

    it('strips toolCalls, startTime, durationMs from the last assistant message', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'response',
          toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }],
          startTime: '2024-01-01T00:00:00Z',
          durationMs: 500,
          metadata: { key: 'value' },
        },
      ];
      const result = trimOutputMessages(messages as any, 1);
      expect(result).toEqual([{ role: 'assistant', content: 'response' }]);
      expect(result[0]).not.toHaveProperty('toolCalls');
      expect(result[0]).not.toHaveProperty('startTime');
      expect(result[0]).not.toHaveProperty('durationMs');
      expect(result[0]).not.toHaveProperty('metadata');
    });
  });

  describe('outputMessages = N (numeric)', () => {
    it('returns last N messages (any role) trimmed to { role, content }', () => {
      const result = trimOutputMessages(makeMessages() as any, 3);
      expect(result).toEqual([
        { role: 'assistant', content: 'Hi there' },
        { role: 'tool', content: 'file contents' },
        { role: 'assistant', content: 'Done!' },
      ]);
    });

    it('returns all messages when N exceeds message count', () => {
      const result = trimOutputMessages(makeMessages() as any, 100);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('strips metadata from all returned messages', () => {
      const result = trimOutputMessages(makeMessages() as any, 2);
      for (const msg of result) {
        expect(Object.keys(msg).sort()).toEqual(['content', 'role']);
      }
    });
  });

  describe('outputMessages = "all"', () => {
    it('returns all messages trimmed to { role, content }', () => {
      const result = trimOutputMessages(makeMessages() as any, 'all');
      expect(result).toHaveLength(4);
      expect(result).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'tool', content: 'file contents' },
        { role: 'assistant', content: 'Done!' },
      ]);
    });

    it('strips all metadata fields from every message', () => {
      const result = trimOutputMessages(makeMessages() as any, 'all');
      for (const msg of result) {
        expect(msg).not.toHaveProperty('toolCalls');
        expect(msg).not.toHaveProperty('startTime');
        expect(msg).not.toHaveProperty('durationMs');
        expect(msg).not.toHaveProperty('name');
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty output array', () => {
      expect(trimOutputMessages([] as any, 1)).toEqual([]);
      expect(trimOutputMessages([] as any, 5)).toEqual([]);
      expect(trimOutputMessages([] as any, 'all')).toEqual([]);
    });
  });
});
