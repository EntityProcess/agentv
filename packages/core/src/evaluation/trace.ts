/**
 * Trace event types for capturing agent execution traces.
 * Provides a normalized, provider-agnostic model for tool-call trajectories.
 */

/**
 * Supported trace event types.
 */
export type TraceEventType = 'model_step' | 'tool_call' | 'tool_result' | 'message' | 'error';

/**
 * Normalized trace event representing a single step in agent execution.
 * Provider-agnostic format for tool-call trajectory evaluation.
 */
export interface TraceEvent {
  /** Event type */
  readonly type: TraceEventType;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
  /** Stable identifier for pairing tool_call/tool_result */
  readonly id?: string;
  /** Tool name (for tool_call/tool_result) */
  readonly name?: string;
  /** Tool input - any JSON value */
  readonly input?: unknown;
  /** Tool output - any JSON value */
  readonly output?: unknown;
  /** Message content (for message/model_step) */
  readonly text?: string;
  /** Provider-specific metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Compact summary of a trace for lightweight persistence.
 * Included in results by default to avoid payload bloat.
 */
export interface TraceSummary {
  /** Total number of events in trace */
  readonly eventCount: number;
  /** Unique tool names, sorted alphabetically */
  readonly toolNames: readonly string[];
  /** Map of tool name to call count */
  readonly toolCallsByName: Readonly<Record<string, number>>;
  /** Number of error events */
  readonly errorCount: number;
}

/**
 * Configuration for tool_trajectory evaluator.
 */
export interface ToolTrajectoryEvaluatorConfig {
  readonly name: string;
  readonly type: 'tool_trajectory';
  /** Matching mode */
  readonly mode: 'any_order' | 'in_order' | 'exact';
  /** Minimum call counts per tool (for any_order mode) */
  readonly minimums?: Readonly<Record<string, number>>;
  /** Expected tool sequence (for in_order/exact modes) */
  readonly expected?: readonly ToolTrajectoryExpectedItem[];
}

/**
 * Expected tool call item in a trajectory sequence.
 */
export interface ToolTrajectoryExpectedItem {
  readonly tool: string;
}

/**
 * Expected tool call specification for expected_messages validation.
 */
export interface ExpectedToolCall {
  /** Tool name (required) */
  readonly tool: string;
  /** Tool input - if specified, must match exactly */
  readonly input?: unknown;
  /** Tool output - if specified, must match exactly */
  readonly output?: unknown;
}

/**
 * Type guard for TraceEventType values.
 */
export function isTraceEventType(value: unknown): value is TraceEventType {
  return (
    typeof value === 'string' &&
    ['model_step', 'tool_call', 'tool_result', 'message', 'error'].includes(value)
  );
}

/**
 * Type guard for TraceEvent objects.
 */
export function isTraceEvent(value: unknown): value is TraceEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return isTraceEventType(candidate.type) && typeof candidate.timestamp === 'string';
}

/**
 * Type guard for ExpectedToolCall objects.
 */
export function isExpectedToolCall(value: unknown): value is ExpectedToolCall {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.tool === 'string';
}

/**
 * Compute a lightweight summary from a full trace.
 * Used for default result persistence without payload bloat.
 */
export function computeTraceSummary(trace: readonly TraceEvent[]): TraceSummary {
  const toolCallCounts: Record<string, number> = {};
  let errorCount = 0;

  for (const event of trace) {
    if (event.type === 'tool_call' && event.name) {
      toolCallCounts[event.name] = (toolCallCounts[event.name] ?? 0) + 1;
    }
    if (event.type === 'error') {
      errorCount++;
    }
  }

  const toolNames = Object.keys(toolCallCounts).sort();

  return {
    eventCount: trace.length,
    toolNames,
    toolCallsByName: toolCallCounts,
    errorCount,
  };
}
