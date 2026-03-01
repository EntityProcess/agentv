/**
 * Tests for computeTraceSummary function.
 * Verifies span-based timing derivation, tool duration computation, and LLM call counting.
 */

import { describe, expect, it } from 'bun:test';
import { computeTraceSummary } from '../../src/evaluation/trace.js';

describe('computeTraceSummary', () => {
  describe('startTime/endTime derivation', () => {
    it('derives startTime from earliest message startTime', () => {
      const messages = [
        { role: 'user', startTime: '2024-01-01T10:00:00Z' },
        { role: 'assistant', startTime: '2024-01-01T10:00:05Z' },
        { role: 'assistant', startTime: '2024-01-01T10:00:10Z' },
      ];

      const result = computeTraceSummary(messages);

      expect(result.startTime).toBe('2024-01-01T10:00:00.000Z');
    });

    it('derives endTime from latest message endTime', () => {
      const messages = [
        { role: 'user', startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T10:00:01Z' },
        { role: 'assistant', startTime: '2024-01-01T10:00:05Z', endTime: '2024-01-01T10:00:08Z' },
        { role: 'assistant', startTime: '2024-01-01T10:00:10Z', endTime: '2024-01-01T10:00:15Z' },
      ];

      const result = computeTraceSummary(messages);

      expect(result.endTime).toBe('2024-01-01T10:00:15.000Z');
    });

    it('derives timing from tool call spans when messages lack timing', () => {
      const messages = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', startTime: '2024-01-01T10:00:02Z', endTime: '2024-01-01T10:00:03Z' },
            { tool: 'analyze', startTime: '2024-01-01T10:00:04Z', endTime: '2024-01-01T10:00:06Z' },
          ],
        },
      ];

      const result = computeTraceSummary(messages);

      expect(result.startTime).toBe('2024-01-01T10:00:02.000Z');
      expect(result.endTime).toBe('2024-01-01T10:00:06.000Z');
    });

    it('combines message and tool call timing to find boundaries', () => {
      const messages = [
        {
          role: 'assistant',
          startTime: '2024-01-01T10:00:01Z',
          toolCalls: [
            { tool: 'search', startTime: '2024-01-01T10:00:02Z', endTime: '2024-01-01T10:00:05Z' },
          ],
          endTime: '2024-01-01T10:00:10Z',
        },
      ];

      const result = computeTraceSummary(messages);

      expect(result.startTime).toBe('2024-01-01T10:00:01.000Z');
      expect(result.endTime).toBe('2024-01-01T10:00:10.000Z');
    });

    it('returns undefined for startTime/endTime when no timing data available', () => {
      const messages = [{ role: 'user' }, { role: 'assistant', toolCalls: [{ tool: 'search' }] }];

      const result = computeTraceSummary(messages);

      expect(result.startTime).toBeUndefined();
      expect(result.endTime).toBeUndefined();
    });
  });

  describe('toolDurations computation', () => {
    it('uses durationMs when provided', () => {
      const messages = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', durationMs: 100 },
            { tool: 'search', durationMs: 150 },
            { tool: 'analyze', durationMs: 200 },
          ],
        },
      ];

      const result = computeTraceSummary(messages);

      expect(result.trace.toolDurations).toEqual({
        search: [100, 150],
        analyze: [200],
      });
    });

    it('derives duration from startTime/endTime when durationMs not provided', () => {
      const messages = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T10:00:02Z' },
            {
              tool: 'analyze',
              startTime: '2024-01-01T10:00:03.500Z',
              endTime: '2024-01-01T10:00:04Z',
            },
          ],
        },
      ];

      const result = computeTraceSummary(messages);

      expect(result.trace.toolDurations).toEqual({
        search: [2000],
        analyze: [500],
      });
    });

    it('prefers durationMs over computed duration when both available', () => {
      const messages = [
        {
          role: 'assistant',
          toolCalls: [
            {
              tool: 'search',
              durationMs: 1500,
              startTime: '2024-01-01T10:00:00Z',
              endTime: '2024-01-01T10:00:02Z',
            },
          ],
        },
      ];

      const result = computeTraceSummary(messages);

      expect(result.trace.toolDurations).toEqual({
        search: [1500],
      });
    });

    it('omits toolDurations when no duration data available', () => {
      const messages = [
        {
          role: 'assistant',
          toolCalls: [{ tool: 'search' }, { tool: 'analyze' }],
        },
      ];

      const result = computeTraceSummary(messages);

      expect(result.trace.toolDurations).toBeUndefined();
    });

    it('handles mixed tool calls with and without duration data', () => {
      const messages = [
        {
          role: 'assistant',
          toolCalls: [
            { tool: 'search', durationMs: 100 },
            { tool: 'search' }, // no duration
            { tool: 'analyze', startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T10:00:01Z' },
          ],
        },
      ];

      const result = computeTraceSummary(messages);

      // Only includes tools that have duration data
      expect(result.trace.toolDurations).toEqual({
        search: [100],
        analyze: [1000],
      });
    });
  });

  describe('llmCallCount computation', () => {
    it('counts assistant messages as LLM calls', () => {
      const messages = [
        { role: 'user' },
        { role: 'assistant' },
        { role: 'user' },
        { role: 'assistant' },
        { role: 'assistant' },
      ];

      const result = computeTraceSummary(messages);

      expect(result.trace.llmCallCount).toBe(3);
    });

    it('returns 0 for llmCallCount when no assistant messages', () => {
      const messages = [{ role: 'user' }, { role: 'system' }, { role: 'tool' }];

      const result = computeTraceSummary(messages);

      expect(result.trace.llmCallCount).toBe(0);
    });

    it('returns 0 for llmCallCount on empty messages', () => {
      const result = computeTraceSummary([]);

      expect(result.trace.llmCallCount).toBe(0);
    });
  });

  describe('combined functionality', () => {
    it('computes all fields correctly for a realistic trace', () => {
      const messages = [
        { role: 'user', startTime: '2024-01-01T10:00:00Z' },
        {
          role: 'assistant',
          startTime: '2024-01-01T10:00:01Z',
          endTime: '2024-01-01T10:00:05Z',
          toolCalls: [
            {
              tool: 'search',
              durationMs: 1500,
              startTime: '2024-01-01T10:00:02Z',
              endTime: '2024-01-01T10:00:03.5Z',
            },
            { tool: 'analyze', durationMs: 2000 },
          ],
        },
        {
          role: 'assistant',
          startTime: '2024-01-01T10:00:06Z',
          endTime: '2024-01-01T10:00:10Z',
          toolCalls: [
            { tool: 'search', startTime: '2024-01-01T10:00:07Z', endTime: '2024-01-01T10:00:08Z' },
          ],
        },
      ];

      const result = computeTraceSummary(messages);

      expect(result.trace.eventCount).toBe(3);
      expect(result.trace.toolNames).toEqual(['analyze', 'search']);
      expect(result.trace.toolCallsByName).toEqual({ search: 2, analyze: 1 });
      expect(result.trace.errorCount).toBe(0);
      expect(result.startTime).toBe('2024-01-01T10:00:00.000Z');
      expect(result.endTime).toBe('2024-01-01T10:00:10.000Z');
      expect(result.trace.llmCallCount).toBe(2);
      expect(result.trace.toolDurations).toEqual({
        search: [1500, 1000],
        analyze: [2000],
      });
    });

    it('handles messages with no timing data gracefully', () => {
      const messages = [
        { role: 'user' },
        { role: 'assistant', toolCalls: [{ tool: 'search' }] },
        { role: 'assistant' },
      ];

      const result = computeTraceSummary(messages);

      expect(result.trace.eventCount).toBe(1);
      expect(result.trace.toolNames).toEqual(['search']);
      expect(result.trace.toolCallsByName).toEqual({ search: 1 });
      expect(result.trace.errorCount).toBe(0);
      expect(result.startTime).toBeUndefined();
      expect(result.endTime).toBeUndefined();
      expect(result.trace.llmCallCount).toBe(2);
      expect(result.trace.toolDurations).toBeUndefined();
    });
  });
});
