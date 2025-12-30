/**
 * Trace event types for capturing agent execution traces.
 * Provides a normalized, provider-agnostic model for tool-call trajectories.
 */

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
  /** Optional weight for top-level aggregation (defaults to 1.0) */
  readonly weight?: number;
}

/**
 * Expected tool call item in a trajectory sequence.
 */
export interface ToolTrajectoryExpectedItem {
  readonly tool: string;
}

/**
 * Simplified input type for computeTraceSummary.
 * Matches OutputMessage structure without requiring full provider/types import.
 */
interface OutputMessageLike {
  readonly toolCalls?: readonly {
    readonly tool: string;
  }[];
}

/**
 * Compute a lightweight summary from output messages.
 * Used for default result persistence without payload bloat.
 */
export function computeTraceSummary(messages: readonly OutputMessageLike[]): TraceSummary {
  const toolCallCounts: Record<string, number> = {};
  let totalToolCalls = 0;

  for (const message of messages) {
    if (!message.toolCalls) continue;

    for (const toolCall of message.toolCalls) {
      toolCallCounts[toolCall.tool] = (toolCallCounts[toolCall.tool] ?? 0) + 1;
      totalToolCalls++;
    }
  }

  const toolNames = Object.keys(toolCallCounts).sort();

  return {
    eventCount: totalToolCalls,
    toolNames,
    toolCallsByName: toolCallCounts,
    errorCount: 0,
  };
}
