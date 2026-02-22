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
  /** ISO 8601 timestamp when execution started (derived from earliest span) */
  readonly startTime?: string;
  /** ISO 8601 timestamp when execution ended (derived from latest span) */
  readonly endTime?: string;
  /** Number of LLM calls (assistant messages) */
  readonly llmCallCount?: number;
}

/**
 * Argument matching mode for tool_trajectory expected items.
 * - 'exact': bidirectional deep equality, no extra keys allowed (default)
 * - 'superset': actual args must contain all expected keys (extras OK)
 * - 'subset': actual args must be a subset of expected keys (no unexpected keys)
 * - 'ignore': skip argument checking entirely
 */
export type ArgsMatchMode = 'exact' | 'ignore' | 'subset' | 'superset';

/**
 * Configuration for tool_trajectory evaluator.
 */
export interface ToolTrajectoryEvaluatorConfig {
  readonly name: string;
  readonly type: 'tool_trajectory';
  /** Matching mode */
  readonly mode: 'any_order' | 'in_order' | 'exact' | 'subset' | 'superset';
  /** Minimum call counts per tool (for any_order mode) */
  readonly minimums?: Readonly<Record<string, number>>;
  /** Expected tool sequence (for in_order/exact/subset/superset modes) */
  readonly expected?: readonly ToolTrajectoryExpectedItem[];
  /** Optional weight for top-level aggregation (defaults to 1.0) */
  readonly weight?: number;
  readonly required?: boolean | number;
  /** When true, inverts the evaluator score (1 - score) and swaps pass/fail verdict */
  readonly negate?: boolean;
  /** Default argument matching mode for all expected items (defaults to 'exact') */
  readonly argsMatch?: ArgsMatchMode | readonly string[];
}

/**
 * Expected tool call item in a trajectory sequence.
 */
export interface ToolTrajectoryExpectedItem {
  readonly tool: string;
  /** Optional argument matching: 'any' skips validation, object performs partial deep equality */
  readonly args?: 'any' | Record<string, unknown>;
  /** Optional maximum duration in milliseconds for latency assertions */
  readonly maxDurationMs?: number;
  /** Per-item argument matching mode override (takes precedence over evaluator-level argsMatch) */
  readonly argsMatch?: ArgsMatchMode | readonly string[];
}

/**
 * Simplified input type for computeTraceSummary.
 * Matches Message structure without requiring full provider/types import.
 */
interface MessageLike {
  readonly role?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly toolCalls?: readonly {
    readonly tool: string;
    readonly startTime?: string;
    readonly endTime?: string;
    readonly durationMs?: number;
  }[];
}

/**
 * Compute a lightweight summary from output messages.
 * Used for default result persistence without payload bloat.
 *
 * Derives timing information from span boundaries:
 * - startTime: earliest startTime across all messages and tool calls
 * - endTime: latest endTime across all messages and tool calls
 * - toolDurations: per-tool duration arrays (from durationMs or computed from start/end)
 * - llmCallCount: count of assistant messages
 */
export function computeTraceSummary(messages: readonly MessageLike[]): TraceSummary {
  const toolCallCounts: Record<string, number> = {};
  const toolDurations: Record<string, number[]> = {};
  let totalToolCalls = 0;
  let llmCallCount = 0;
  let earliestStart: Date | undefined;
  let latestEnd: Date | undefined;
  let hasAnyDuration = false;

  for (const message of messages) {
    // Count assistant messages as LLM calls
    if (message.role === 'assistant') {
      llmCallCount++;
    }

    // Track message timing boundaries
    if (message.startTime) {
      const startDate = new Date(message.startTime);
      if (!earliestStart || startDate < earliestStart) {
        earliestStart = startDate;
      }
    }
    if (message.endTime) {
      const endDate = new Date(message.endTime);
      if (!latestEnd || endDate > latestEnd) {
        latestEnd = endDate;
      }
    }

    if (!message.toolCalls) continue;

    for (const toolCall of message.toolCalls) {
      toolCallCounts[toolCall.tool] = (toolCallCounts[toolCall.tool] ?? 0) + 1;
      totalToolCalls++;

      // Track tool call timing boundaries
      if (toolCall.startTime) {
        const startDate = new Date(toolCall.startTime);
        if (!earliestStart || startDate < earliestStart) {
          earliestStart = startDate;
        }
      }
      if (toolCall.endTime) {
        const endDate = new Date(toolCall.endTime);
        if (!latestEnd || endDate > latestEnd) {
          latestEnd = endDate;
        }
      }

      // Compute tool duration
      let duration: number | undefined = toolCall.durationMs;
      if (duration === undefined && toolCall.startTime && toolCall.endTime) {
        const start = new Date(toolCall.startTime).getTime();
        const end = new Date(toolCall.endTime).getTime();
        duration = end - start;
      }

      if (duration !== undefined) {
        hasAnyDuration = true;
        if (!toolDurations[toolCall.tool]) {
          toolDurations[toolCall.tool] = [];
        }
        toolDurations[toolCall.tool].push(duration);
      }
    }
  }

  const toolNames = Object.keys(toolCallCounts).sort();

  return {
    eventCount: totalToolCalls,
    toolNames,
    toolCallsByName: toolCallCounts,
    errorCount: 0,
    startTime: earliestStart?.toISOString(),
    endTime: latestEnd?.toISOString(),
    llmCallCount,
    ...(hasAnyDuration ? { toolDurations } : {}),
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
  /** ISO 8601 timestamp when execution started */
  readonly startTime?: string;
  /** ISO 8601 timestamp when execution ended */
  readonly endTime?: string;
}

/**
 * Merge execution metrics from provider response into a trace summary.
 * Returns a new TraceSummary with metrics fields populated.
 * Provider-level timing takes precedence over span-derived timing.
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
    // Provider-level timing takes precedence over span-derived timing
    startTime: metrics.startTime ?? summary.startTime,
    endTime: metrics.endTime ?? summary.endTime,
  };
}
