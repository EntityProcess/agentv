import { describe, expect, it } from 'bun:test';

import type { Message } from '@agentv/core';

import { trimOutputMessages } from '../../../src/commands/eval/run-eval.js';

const makeMessages = (): readonly Message[] => [
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
      const result = trimOutputMessages(makeMessages(), 1);
      expect(result).toEqual([{ role: 'assistant', content: 'Done!' }]);
    });

    it('returns empty array when no assistant message exists', () => {
      const messages: readonly Message[] = [{ role: 'user', content: 'Hello' }];
      const result = trimOutputMessages(messages, 1);
      expect(result).toEqual([]);
    });

    it('strips toolCalls, startTime, durationMs from the last assistant message', () => {
      const messages: readonly Message[] = [
        {
          role: 'assistant',
          content: 'response',
          toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }],
          startTime: '2024-01-01T00:00:00Z',
          durationMs: 500,
        },
      ];
      const result = trimOutputMessages(messages, 1);
      expect(result).toEqual([{ role: 'assistant', content: 'response' }]);
      expect(result[0]).not.toHaveProperty('toolCalls');
      expect(result[0]).not.toHaveProperty('startTime');
      expect(result[0]).not.toHaveProperty('durationMs');
    });
  });

  describe('outputMessages = N (numeric)', () => {
    it('returns last N messages (any role) trimmed to { role, content }', () => {
      const result = trimOutputMessages(makeMessages(), 3);
      expect(result).toEqual([
        { role: 'assistant', content: 'Hi there' },
        { role: 'tool', content: 'file contents' },
        { role: 'assistant', content: 'Done!' },
      ]);
    });

    it('returns all messages when N exceeds message count', () => {
      const result = trimOutputMessages(makeMessages(), 100);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('strips metadata from all returned messages', () => {
      const result = trimOutputMessages(makeMessages(), 2);
      for (const msg of result) {
        expect(Object.keys(msg).sort()).toEqual(['content', 'role']);
      }
    });
  });

  describe('outputMessages = "all"', () => {
    it('returns all messages trimmed to { role, content }', () => {
      const result = trimOutputMessages(makeMessages(), 'all');
      expect(result).toHaveLength(4);
      expect(result).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'tool', content: 'file contents' },
        { role: 'assistant', content: 'Done!' },
      ]);
    });

    it('strips all metadata fields from every message', () => {
      const result = trimOutputMessages(makeMessages(), 'all');
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
      const empty: readonly Message[] = [];
      expect(trimOutputMessages(empty, 1)).toEqual([]);
      expect(trimOutputMessages(empty, 5)).toEqual([]);
      expect(trimOutputMessages(empty, 'all')).toEqual([]);
    });
  });
});
