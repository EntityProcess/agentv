/**
 * Trace event types for capturing agent execution traces.
 * Provides a normalized, provider-agnostic model for tool-call trajectories.
 */

/**
 * Token usage metrics from provider execution.
 */
export interface TokenUsage {
  /** Input/prompt tokens consumed */
  readonly input: number;
  /** Output/completion tokens generated */
  readonly output: number;
  /** Cached tokens (optional, provider-specific) */
  readonly cached?: number;
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
  /** Token usage metrics (optional, from provider) */
  readonly tokenUsage?: TokenUsage;
  /** Total cost in USD (optional, from provider) */
  readonly costUsd?: number;
  /** Total execution duration in milliseconds (optional) */
  readonly durationMs?: number;
  /** Per-tool duration arrays in milliseconds (optional) */
  readonly toolDurations?: Readonly<Record<string, readonly number[]>>;
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
  /** Optional argument matching: 'any' skips validation, object performs partial deep equality */
  readonly args?: 'any' | Record<string, unknown>;
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

/**
 * Default tool names considered as exploration/read-only operations.
 * Can be overridden per-evaluation via config.
 */
export const DEFAULT_EXPLORATION_TOOLS = [
  'read',
  'grep',
  'glob',
  'search',
  'list',
  'Read',
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
] as const;

/**
 * Ratio of exploration tool calls to total tool calls.
 * Returns undefined if there are no tool calls.
 *
 * @param summary - Trace summary with tool call counts
 * @param explorationTools - Tool names considered exploration (defaults to DEFAULT_EXPLORATION_TOOLS)
 * @returns Ratio between 0 and 1, or undefined if no tool calls
 */
export function explorationRatio(
  summary: TraceSummary,
  explorationTools: readonly string[] = DEFAULT_EXPLORATION_TOOLS,
): number | undefined {
  if (summary.eventCount === 0) return undefined;

  const explorationCalls = explorationTools.reduce(
    (sum, tool) => sum + (summary.toolCallsByName[tool] ?? 0),
    0,
  );

  return explorationCalls / summary.eventCount;
}

/**
 * Average tokens consumed per tool call.
 * Returns undefined if tokenUsage is not available or no tool calls.
 *
 * @param summary - Trace summary with optional token usage
 * @returns Average tokens per tool call, or undefined
 */
export function tokensPerTool(summary: TraceSummary): number | undefined {
  if (!summary.tokenUsage || summary.eventCount === 0) return undefined;

  const totalTokens = summary.tokenUsage.input + summary.tokenUsage.output;
  return totalTokens / summary.eventCount;
}

/**
 * Average tool duration across all tool calls.
 * Returns undefined if toolDurations is not available or empty.
 *
 * @param summary - Trace summary with optional tool durations
 * @returns Average duration in milliseconds, or undefined
 */
export function avgToolDurationMs(summary: TraceSummary): number | undefined {
  if (!summary.toolDurations) return undefined;

  let totalDuration = 0;
  let totalCalls = 0;

  for (const durations of Object.values(summary.toolDurations)) {
    for (const duration of durations) {
      totalDuration += duration;
      totalCalls++;
    }
  }

  if (totalCalls === 0) return undefined;
  return totalDuration / totalCalls;
}

/**
 * Execution metrics from provider response.
 */
export interface ExecutionMetrics {
  readonly tokenUsage?: TokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
}

/**
 * Merge execution metrics from provider response into a trace summary.
 * Returns a new TraceSummary with metrics fields populated.
 *
 * @param summary - Base trace summary from computeTraceSummary
 * @param metrics - Optional execution metrics from provider
 * @returns TraceSummary with merged metrics
 */
export function mergeExecutionMetrics(
  summary: TraceSummary,
  metrics?: ExecutionMetrics,
): TraceSummary {
  if (!metrics) return summary;

  return {
    ...summary,
    tokenUsage: metrics.tokenUsage,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
  };
}
