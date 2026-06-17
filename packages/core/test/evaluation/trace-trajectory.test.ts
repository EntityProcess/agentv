import { describe, expect, it } from 'bun:test';

import {
  NORMALIZED_TRAJECTORY_SCHEMA_VERSION,
  type NormalizedTrajectory,
  NormalizedTrajectoryWireSchema,
  computeTraceSummary,
  computeTraceSummaryFromTrajectory,
  fromNormalizedTrajectoryWire,
  toNormalizedTrajectoryWire,
} from '../../src/evaluation/trace.js';

function jsonComparable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function buildTrajectory(): NormalizedTrajectory {
  return {
    schemaVersion: NORMALIZED_TRAJECTORY_SCHEMA_VERSION,
    source: {
      kind: 'pi_session',
      path: 'traces/pi-session.jsonl',
      provider: 'pi',
      format: 'jsonl',
      version: '2026-06',
      metadata: { imported_by: 'test' },
    },
    session: {
      sessionId: 'session-123',
      conversationId: 'conversation-456',
      cwd: '/repo',
      startedAt: '2026-06-08T10:00:00Z',
      endedAt: '2026-06-08T10:00:08Z',
    },
    branch: {
      selectedLeafId: 'leaf-success',
      selectedPathIds: ['root', 'leaf-success'],
      includedEventIds: ['evt-user', 'evt-model', 'evt-read', 'evt-write-error'],
      omittedEventIds: ['leaf-retry'],
      selectionReason: 'explicit leaf selected for evaluation',
    },
    events: [
      {
        eventId: 'evt-user',
        ordinal: 0,
        type: 'message',
        timestamp: '2026-06-08T10:00:00Z',
        message: {
          role: 'user',
          content: 'Inspect the repository.',
        },
        sourceRef: {
          eventId: 'raw-user-1',
          messageId: 'msg-user-1',
          rawKind: 'pi.message',
          path: 'traces/pi-session.jsonl',
          line: 4,
        },
      },
      {
        eventId: 'evt-model',
        parentEventId: 'evt-user',
        ordinal: 1,
        type: 'model_turn',
        timestamp: '2026-06-08T10:00:01Z',
        durationMs: 3000,
        turnIndex: 0,
        model: {
          provider: 'openai',
          name: 'gpt-5',
          invocationId: 'invocation-1',
          tokenUsage: { input: 100, output: 24, reasoning: 12 },
        },
      },
      {
        eventId: 'evt-read',
        parentEventId: 'evt-model',
        ordinal: 2,
        type: 'tool_call',
        timestamp: '2026-06-08T10:00:02Z',
        durationMs: 150,
        durationInferred: true,
        turnIndex: 0,
        tool: {
          name: 'read_file',
          callId: 'call-read',
          input: { path: 'src/app.ts' },
          output: { bytes: 42 },
          status: 'ok',
          redaction: {
            level: 'partial',
            fields: ['output.secret_token'],
            reason: 'secret-like output omitted',
          },
        },
        rawEvidence: [
          {
            kind: 'file',
            ref: 'artifacts/raw/pi-event-7.json',
            mediaType: 'application/json',
            redacted: true,
          },
        ],
        sourceRef: {
          eventId: 'raw-tool-7',
          spanId: 'span-read',
          traceId: 'trace-1',
          rawKind: 'pi.toolCall',
        },
      },
      {
        eventId: 'evt-write-error',
        parentEventId: 'evt-model',
        ordinal: 3,
        type: 'tool_call',
        timestamp: '2026-06-08T10:00:05Z',
        durationMs: 1000,
        turnIndex: 0,
        tool: {
          name: 'write_file',
          callId: 'call-write',
          input: { path: 'src/app.ts' },
          status: 'error',
          error: {
            message: 'Permission denied',
            code: 'EACCES',
          },
        },
      },
    ],
    tokenUsage: { input: 100, output: 24, reasoning: 12 },
    costUsd: 0.002,
    durationMs: 8000,
    metadata: { fixture: true },
  };
}

describe('derived trajectory contract', () => {
  it('round-trips between internal camelCase and snake_case wire format', () => {
    const trajectory = buildTrajectory();

    const wire = toNormalizedTrajectoryWire(trajectory);

    expect(wire.schema_version).toBe('agentv.trajectory.v1');
    expect(wire.source.kind).toBe('pi_session');
    expect(wire.session.session_id).toBe('session-123');
    expect(wire.branch?.selected_leaf_id).toBe('leaf-success');
    expect(wire.events[2]?.duration_inferred).toBe(true);
    expect(wire.events[2]?.tool?.call_id).toBe('call-read');
    expect(wire.events[2]?.source_ref?.raw_kind).toBe('pi.toolCall');
    expect(wire.events[2]?.raw_evidence?.[0]?.media_type).toBe('application/json');

    const roundTrip = fromNormalizedTrajectoryWire(wire);

    expect(jsonComparable(roundTrip)).toEqual(jsonComparable(trajectory));
  });

  it('rejects unsupported schema versions', () => {
    const wire = toNormalizedTrajectoryWire(buildTrajectory());

    expect(() =>
      fromNormalizedTrajectoryWire({
        ...wire,
        schema_version: 'agentv.trace.v2',
      }),
    ).toThrow();
  });

  it('validates missing optional content without fabricating fields', () => {
    const trajectory: NormalizedTrajectory = {
      schemaVersion: NORMALIZED_TRAJECTORY_SCHEMA_VERSION,
      source: { kind: 'imported_transcript' },
      session: { sessionId: 'minimal-session' },
      events: [
        {
          eventId: 'evt-assistant',
          ordinal: 0,
          type: 'message',
          message: { role: 'assistant' },
        },
        {
          eventId: 'evt-tool',
          ordinal: 1,
          type: 'tool_call',
          tool: { name: 'noop' },
        },
      ],
    };

    const wire = toNormalizedTrajectoryWire(trajectory);
    const roundTrip = fromNormalizedTrajectoryWire(wire);

    expect(wire.events[0]?.message).not.toHaveProperty('content');
    expect(wire.events[1]?.tool).not.toHaveProperty('input');
    expect(jsonComparable(roundTrip)).toEqual(jsonComparable(trajectory));
  });

  it('preserves branch metadata and derives summaries from the selected branch path', () => {
    const trajectory: NormalizedTrajectory = {
      ...buildTrajectory(),
      branch: {
        selectedLeafId: 'leaf-success',
        includedEventIds: ['evt-read'],
        omittedEventIds: ['evt-write-error'],
      },
    };

    const wire = toNormalizedTrajectoryWire(trajectory);
    const summary = computeTraceSummaryFromTrajectory(fromNormalizedTrajectoryWire(wire));

    expect(wire.branch).toEqual({
      selected_leaf_id: 'leaf-success',
      included_event_ids: ['evt-read'],
      omitted_event_ids: ['evt-write-error'],
    });
    expect(summary.trace.toolCalls).toEqual({ read_file: 1 });
    expect(summary.trace.eventCount).toBe(1);
    expect(summary.trace.errorCount).toBe(0);
  });

  it('preserves redaction, raw evidence, source refs, inferred timing, and tool errors', () => {
    const wire = toNormalizedTrajectoryWire(buildTrajectory());
    const readEvent = wire.events.find((event) => event.event_id === 'evt-read');
    const errorEvent = wire.events.find((event) => event.event_id === 'evt-write-error');

    expect(readEvent?.duration_inferred).toBe(true);
    expect(readEvent?.tool?.redaction).toEqual({
      level: 'partial',
      fields: ['output.secret_token'],
      reason: 'secret-like output omitted',
    });
    expect(readEvent?.raw_evidence).toEqual([
      {
        kind: 'file',
        ref: 'artifacts/raw/pi-event-7.json',
        media_type: 'application/json',
        redacted: true,
      },
    ]);
    expect(readEvent?.source_ref).toEqual({
      event_id: 'raw-tool-7',
      span_id: 'span-read',
      trace_id: 'trace-1',
      raw_kind: 'pi.toolCall',
    });
    expect(errorEvent?.tool?.status).toBe('error');
    expect(errorEvent?.tool?.error).toEqual({
      message: 'Permission denied',
      code: 'EACCES',
    });

    const summary = computeTraceSummaryFromTrajectory(fromNormalizedTrajectoryWire(wire));

    expect(summary.trace.errorCount).toBe(1);
    expect(summary.trace.toolDurations).toEqual({
      read_file: [150],
      write_file: [1000],
    });
  });

  it('derives the existing TraceSummary shape from full trajectories', () => {
    const messages = [
      { role: 'user', startTime: '2026-06-08T10:00:00Z' },
      {
        role: 'assistant',
        startTime: '2026-06-08T10:00:01Z',
        endTime: '2026-06-08T10:00:04Z',
        toolCalls: [
          {
            tool: 'read_file',
            startTime: '2026-06-08T10:00:02Z',
            endTime: '2026-06-08T10:00:02.150Z',
          },
          {
            tool: 'write_file',
            durationMs: 1000,
            startTime: '2026-06-08T10:00:05Z',
            endTime: '2026-06-08T10:00:06Z',
          },
        ],
      },
    ];
    const trajectory: NormalizedTrajectory = {
      schemaVersion: NORMALIZED_TRAJECTORY_SCHEMA_VERSION,
      source: { kind: 'agentv_run' },
      session: { sessionId: 'agentv-run-1' },
      events: [
        {
          eventId: 'evt-user',
          ordinal: 0,
          type: 'message',
          timestamp: '2026-06-08T10:00:00Z',
          message: { role: 'user' },
        },
        {
          eventId: 'evt-model',
          ordinal: 1,
          type: 'model_turn',
          timestamp: '2026-06-08T10:00:01Z',
          durationMs: 3000,
        },
        {
          eventId: 'evt-read',
          ordinal: 2,
          type: 'tool_call',
          timestamp: '2026-06-08T10:00:02Z',
          durationMs: 150,
          tool: { name: 'read_file', status: 'ok' },
        },
        {
          eventId: 'evt-write',
          ordinal: 3,
          type: 'tool_call',
          timestamp: '2026-06-08T10:00:05Z',
          durationMs: 1000,
          tool: { name: 'write_file', status: 'ok' },
        },
      ],
    };

    const fromMessages = computeTraceSummary(messages);
    const fromTrajectory = computeTraceSummaryFromTrajectory(trajectory);

    expect(fromTrajectory).toEqual(fromMessages);
  });

  it('keeps TraceSummary as a derived read model outside trajectory wire state', () => {
    const trajectory = buildTrajectory();
    const wire = toNormalizedTrajectoryWire(trajectory);
    const summary = computeTraceSummaryFromTrajectory(fromNormalizedTrajectoryWire(wire));

    expect(wire).not.toHaveProperty('trace');
    expect(wire).not.toHaveProperty('summary');
    expect(wire).not.toHaveProperty('trace_summary');
    expect(summary.trace).toEqual({
      eventCount: 2,
      toolCalls: {
        read_file: 1,
        write_file: 1,
      },
      errorCount: 1,
      toolDurations: {
        read_file: [150],
        write_file: [1000],
      },
      llmCallCount: 1,
    });
  });

  it('counts LLM turns once when message and model_turn events coexist', () => {
    const trajectory: NormalizedTrajectory = {
      schemaVersion: NORMALIZED_TRAJECTORY_SCHEMA_VERSION,
      source: { kind: 'agentv_run' },
      session: { sessionId: 'agentv-run-2' },
      events: [
        {
          eventId: 'evt-assistant-message',
          ordinal: 0,
          type: 'message',
          message: { role: 'assistant', content: 'I will inspect the repo.' },
          turnIndex: 0,
        },
        {
          eventId: 'evt-model-turn',
          ordinal: 1,
          type: 'model_turn',
          turnIndex: 0,
        },
        {
          eventId: 'evt-tool',
          ordinal: 2,
          type: 'tool_call',
          tool: { name: 'read_file', status: 'unknown' },
        },
      ],
    };

    const summary = computeTraceSummaryFromTrajectory(trajectory);

    expect(summary.trace.llmCallCount).toBe(1);
    expect(summary.trace.errorCount).toBe(0);
  });

  it('exposes a Zod schema for direct wire validation', () => {
    const wire = toNormalizedTrajectoryWire(buildTrajectory());

    expect(NormalizedTrajectoryWireSchema.parse(wire).events).toHaveLength(4);
  });
});
