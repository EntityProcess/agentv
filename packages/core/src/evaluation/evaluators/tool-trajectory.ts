import type { Message } from '../providers/types.js';
import type {
  ArgsMatchMode,
  ToolTrajectoryEvaluatorConfig,
  ToolTrajectoryExpectedItem,
  TraceSummary,
} from '../trace.js';
import { deepEqual, scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

/** Extracted tool call with optional arguments and timing */
interface ExtractedToolCall {
  readonly name: string;
  readonly args?: Record<string, unknown>;
  readonly durationMs?: number;
}

/**
 * Get a nested value from an object using dot-notation path.
 * Supports paths like "a.b.c" to access deeply nested properties.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Resolve the effective args match mode for an expected item.
 * Priority: per-item argsMatch > evaluator-level defaultArgsMatch > 'exact'
 */
function resolveArgsMatchMode(
  item: ToolTrajectoryExpectedItem,
  config: ToolTrajectoryEvaluatorConfig,
): ArgsMatchMode | readonly string[] {
  return item.argsMatch ?? config.defaultArgsMatch ?? 'exact';
}

/**
 * Check if actual args match expected args using the specified mode.
 *
 * Modes:
 * - 'exact': bidirectional deep equality (no extra keys allowed)
 * - 'superset': actual must contain all expected keys (extras OK) - was the old implicit default
 * - 'subset': actual must be a subset of expected (no unexpected keys in actual)
 * - 'ignore': skip argument checking entirely
 * - string[]: check only the listed fields (dot-notation supported)
 */
function argsMatch(
  expected: ToolTrajectoryExpectedItem['args'],
  actual: Record<string, unknown> | undefined,
  mode: ArgsMatchMode | readonly string[],
): boolean {
  // No args constraint means match (regardless of mode)
  if (expected === undefined) return true;
  // 'any' means skip validation (legacy shorthand for ignore)
  if (expected === 'any') return true;

  // 'ignore' mode skips all arg checking
  if (mode === 'ignore') return true;

  // From here expected is a Record<string, unknown>
  if (actual === undefined) return false;

  // Field list mode: check only the listed fields with deep equality
  if (Array.isArray(mode)) {
    for (const field of mode) {
      const expectedVal = getNestedValue(expected, field);
      const actualVal = getNestedValue(actual, field);
      if (expectedVal === undefined) continue; // Skip fields not specified in expected
      if (!deepEqual(expectedVal, actualVal)) return false;
    }
    return true;
  }

  switch (mode) {
    case 'exact':
      return deepEqual(expected, actual);

    case 'superset':
      // actual must contain all expected keys (extras OK)
      for (const key of Object.keys(expected)) {
        if (!Object.hasOwn(actual, key)) return false;
        if (!deepEqual(expected[key], actual[key])) return false;
      }
      return true;

    case 'subset':
      // actual must be a subset of expected (no unexpected keys in actual)
      for (const key of Object.keys(actual)) {
        if (!Object.hasOwn(expected, key)) return false;
        if (!deepEqual(actual[key], expected[key])) return false;
      }
      return true;

    default:
      return deepEqual(expected, actual);
  }
}

/** Result of checking latency assertion */
interface LatencyCheckResult {
  /** Whether the check passed, failed, or was skipped */
  readonly status: 'pass' | 'fail' | 'skip';
  /** Message describing the result */
  readonly message: string;
}

/**
 * Check latency assertion for a tool call.
 * Returns pass/fail/skip status and a descriptive message.
 */
function checkLatency(
  toolName: string,
  maxDurationMs: number | undefined,
  actualDurationMs: number | undefined,
): LatencyCheckResult {
  // No latency assertion specified - nothing to check
  if (maxDurationMs === undefined) {
    return { status: 'skip', message: '' };
  }

  // Latency assertion specified but no timing data available
  if (actualDurationMs === undefined) {
    return {
      status: 'skip',
      message: `No duration data for ${toolName}; latency assertion skipped`,
    };
  }

  // Check the assertion
  if (actualDurationMs <= maxDurationMs) {
    return {
      status: 'pass',
      message: `${toolName} completed in ${actualDurationMs}ms (max: ${maxDurationMs}ms)`,
    };
  }

  return {
    status: 'fail',
    message: `${toolName} took ${actualDurationMs}ms (max: ${maxDurationMs}ms)`,
  };
}

export interface ToolTrajectoryEvaluatorOptions {
  readonly config: ToolTrajectoryEvaluatorConfig;
}

export class ToolTrajectoryEvaluator implements Evaluator {
  readonly kind = 'tool_trajectory';

  private readonly config: ToolTrajectoryEvaluatorConfig;

  constructor(options: ToolTrajectoryEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { output, trace } = context;

    // Extract tool calls from output (primary source)
    const toolCalls = this.extractToolCallsFromMessages(output);
    const hasOutput = output !== undefined && output.length > 0;

    // Handle missing data — but allow empty tool calls through for subset/superset
    // modes when output messages exist (empty call list is valid input for those modes)
    if (toolCalls.length === 0 && !trace && !hasOutput) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No trace available for evaluation'],
        expectedAspectCount: 1,
      };
    }

    // Build summary from tool calls if available, otherwise use provided summary
    const summary = toolCalls.length > 0 ? this.buildSummary(toolCalls) : trace;

    switch (this.config.mode) {
      case 'any_order': {
        if (!summary) {
          return {
            score: 0,
            verdict: 'fail',
            hits: [],
            misses: ['No trace available for evaluation'],
            expectedAspectCount: 1,
          };
        }
        return this.evaluateAnyOrder(summary);
      }
      case 'in_order':
        return this.evaluateInOrder(toolCalls);
      case 'exact':
        return this.evaluateExact(toolCalls);
      case 'superset':
        return this.evaluateSuperset(toolCalls);
      case 'subset':
        return this.evaluateSubset(toolCalls);
      default:
        return {
          score: 0,
          verdict: 'fail',
          hits: [],
          misses: [`Unknown mode: ${this.config.mode}`],
          expectedAspectCount: 1,
        };
    }
  }

  /**
   * Extract tool calls from output messages.
   */
  private extractToolCallsFromMessages(
    messages: readonly Message[] | undefined,
  ): readonly ExtractedToolCall[] {
    if (!messages) {
      return [];
    }

    const toolCalls: ExtractedToolCall[] = [];
    for (const message of messages) {
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          toolCalls.push({
            name: call.tool,
            args: call.input as Record<string, unknown> | undefined,
            durationMs: call.durationMs,
          });
        }
      }
    }
    return toolCalls;
  }

  /**
   * Build a summary from extracted tool calls.
   */
  private buildSummary(toolCalls: readonly ExtractedToolCall[]): TraceSummary {
    const toolCallsByName: Record<string, number> = {};
    for (const call of toolCalls) {
      toolCallsByName[call.name] = (toolCallsByName[call.name] ?? 0) + 1;
    }
    const toolNames = Object.keys(toolCallsByName).sort();
    return {
      eventCount: toolCalls.length,
      toolNames,
      toolCallsByName,
      errorCount: 0,
    };
  }

  private evaluateAnyOrder(summary: TraceSummary): EvaluationScore {
    const minimums = this.config.minimums ?? {};
    const toolNames = Object.keys(minimums);

    if (toolNames.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No tool requirements specified'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];

    for (const toolName of toolNames) {
      const required = minimums[toolName];
      const actual = summary.toolCallsByName[toolName] ?? 0;
      if (actual >= required) {
        hits.push(`${toolName}: called ${actual} times (required >=${required})`);
      } else {
        misses.push(`${toolName}: called ${actual} times (required >=${required})`);
      }
    }

    const score = hits.length / toolNames.length;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: toolNames.length,
    };
  }

  private evaluateInOrder(toolCalls: readonly ExtractedToolCall[]): EvaluationScore {
    const expected = this.config.expected ?? [];

    if (expected.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No tool sequence specified'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];
    const warnings: string[] = [];
    let actualIndex = 0;

    // Track latency assertion results separately for accurate scoring
    let sequenceHits = 0;
    let latencyHits = 0;
    let latencySkips = 0;

    // Count latency assertions specified in expected items
    const latencyAssertionCount = expected.filter(
      (item) => item.maxDurationMs !== undefined,
    ).length;

    for (let i = 0; i < expected.length; i++) {
      const expectedItem = expected[i];
      const expectedTool = expectedItem.tool;
      const mode = resolveArgsMatchMode(expectedItem, this.config);
      let found = false;
      let argsMismatch = false;
      let matchedCall: ExtractedToolCall | undefined;

      while (actualIndex < toolCalls.length) {
        const actualCall = toolCalls[actualIndex];
        if (actualCall.name === expectedTool) {
          // Tool name matches, check args if specified
          if (argsMatch(expectedItem.args, actualCall.args, mode)) {
            hits.push(`Found ${expectedTool} at position ${actualIndex}`);
            sequenceHits++;
            matchedCall = actualCall;
            actualIndex++;
            found = true;
            break;
          }
          // Tool name matches but args don't - this is a miss for this expected item
          misses.push(
            `Expected ${expectedTool} at position ${i}: tool found at ${actualIndex} but args mismatch`,
          );
          actualIndex++;
          argsMismatch = true;
          break;
        }
        actualIndex++;
      }

      if (!found && !argsMismatch) {
        misses.push(`Expected ${expectedTool} at position ${i}, not found in remaining trace`);
      }

      // Check latency assertion if tool was found and latency assertion is specified
      if (found && matchedCall) {
        const latencyResult = checkLatency(
          expectedTool,
          expectedItem.maxDurationMs,
          matchedCall.durationMs,
        );
        if (latencyResult.status === 'pass') {
          hits.push(latencyResult.message);
          latencyHits++;
        } else if (latencyResult.status === 'fail') {
          misses.push(latencyResult.message);
        } else if (latencyResult.message) {
          // Skip with warning message (missing duration data) - neutral, don't count
          warnings.push(latencyResult.message);
          latencySkips++;
        }
      }
    }

    // Log warnings for missing duration data
    for (const warning of warnings) {
      console.warn(`[tool_trajectory] ${warning}`);
    }

    // Calculate score: sequence assertions + effective latency assertions (excluding skipped)
    const effectiveLatencyAssertions = latencyAssertionCount - latencySkips;
    const totalAssertions = expected.length + effectiveLatencyAssertions;
    const score = totalAssertions > 0 ? (sequenceHits + latencyHits) / totalAssertions : 1;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: totalAssertions,
    };
  }

  private evaluateExact(toolCalls: readonly ExtractedToolCall[]): EvaluationScore {
    const expected = this.config.expected ?? [];

    if (expected.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No tool sequence specified'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];
    const warnings: string[] = [];

    // Track latency assertion results separately for accurate scoring
    let sequenceHits = 0;
    let latencyHits = 0;
    let latencySkips = 0;

    // Count latency assertions specified in expected items
    const latencyAssertionCount = expected.filter(
      (item) => item.maxDurationMs !== undefined,
    ).length;

    if (toolCalls.length !== expected.length) {
      misses.push(`Expected ${expected.length} tool calls, got ${toolCalls.length}`);
    }

    const checkLength = Math.min(expected.length, toolCalls.length);
    for (let i = 0; i < checkLength; i++) {
      const expectedItem = expected[i];
      const expectedTool = expectedItem.tool;
      const actualCall = toolCalls[i];
      const actualTool = actualCall.name;
      const mode = resolveArgsMatchMode(expectedItem, this.config);
      let sequenceMatched = false;

      if (actualTool === expectedTool) {
        // Tool name matches, check args if specified
        if (argsMatch(expectedItem.args, actualCall.args, mode)) {
          hits.push(`Position ${i}: ${expectedTool}`);
          sequenceHits++;
          sequenceMatched = true;
        } else {
          misses.push(`Position ${i}: ${expectedTool} args mismatch`);
        }
      } else {
        misses.push(`Position ${i}: expected ${expectedTool}, got ${actualTool}`);
      }

      // Check latency assertion if sequence matched and latency assertion is specified
      if (sequenceMatched) {
        const latencyResult = checkLatency(
          expectedTool,
          expectedItem.maxDurationMs,
          actualCall.durationMs,
        );
        if (latencyResult.status === 'pass') {
          hits.push(latencyResult.message);
          latencyHits++;
        } else if (latencyResult.status === 'fail') {
          misses.push(latencyResult.message);
        } else if (latencyResult.message) {
          // Skip with warning message (missing duration data) - neutral, don't count
          warnings.push(latencyResult.message);
          latencySkips++;
        }
      }
    }

    for (let i = checkLength; i < expected.length; i++) {
      misses.push(`Position ${i}: expected ${expected[i].tool}, got nothing`);
    }

    // Log warnings for missing duration data
    for (const warning of warnings) {
      console.warn(`[tool_trajectory] ${warning}`);
    }

    // Calculate score: sequence assertions + effective latency assertions (excluding skipped)
    const effectiveLatencyAssertions = latencyAssertionCount - latencySkips;
    const totalAssertions = expected.length + effectiveLatencyAssertions;
    const score = totalAssertions > 0 ? (sequenceHits + latencyHits) / totalAssertions : 1;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: totalAssertions,
    };
  }

  /**
   * Superset mode: actual trajectory must contain all expected tool calls.
   * Every expected item must be found in actual (greedy matching with consumption).
   * Extra tool calls in actual are OK.
   */
  private evaluateSuperset(toolCalls: readonly ExtractedToolCall[]): EvaluationScore {
    const expected = this.config.expected ?? [];

    if (expected.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No expected tools specified'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];

    // Track which actual calls have been consumed
    const consumed = new Set<number>();

    for (let i = 0; i < expected.length; i++) {
      const expectedItem = expected[i];
      const expectedTool = expectedItem.tool;
      const mode = resolveArgsMatchMode(expectedItem, this.config);
      let found = false;

      // Greedy: find the first unconsumed actual call that matches
      for (let j = 0; j < toolCalls.length; j++) {
        if (consumed.has(j)) continue;
        const actualCall = toolCalls[j];
        if (
          actualCall.name === expectedTool &&
          argsMatch(expectedItem.args, actualCall.args, mode)
        ) {
          hits.push(`Found ${expectedTool} at position ${j}`);
          consumed.add(j);
          found = true;
          break;
        }
      }

      if (!found) {
        misses.push(`Expected ${expectedTool} not found in actual trajectory`);
      }
    }

    const score = expected.length > 0 ? hits.length / expected.length : 1;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: expected.length,
    };
  }

  /**
   * Subset mode: every actual tool call must be in the allowed list.
   * Expected items are reusable (not consumed) - they define the allowed set.
   * If every actual call matches at least one expected item, score is 1.
   */
  private evaluateSubset(toolCalls: readonly ExtractedToolCall[]): EvaluationScore {
    const expected = this.config.expected ?? [];

    if (expected.length === 0) {
      // No expected items means no calls are allowed
      if (toolCalls.length === 0) {
        return {
          score: 1,
          verdict: 'pass',
          hits: ['No tool calls and no expected tools'],
          misses: [],
          expectedAspectCount: 0,
        };
      }
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`${toolCalls.length} unexpected tool call(s) with empty allowed list`],
        expectedAspectCount: toolCalls.length,
      };
    }

    if (toolCalls.length === 0) {
      return {
        score: 1,
        verdict: 'pass',
        hits: ['No actual tool calls (trivially a subset)'],
        misses: [],
        expectedAspectCount: 0,
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const actualCall = toolCalls[i];
      let allowed = false;

      // Check if actual call matches any expected item (items are reusable)
      for (const expectedItem of expected) {
        const mode = resolveArgsMatchMode(expectedItem, this.config);
        if (
          actualCall.name === expectedItem.tool &&
          argsMatch(expectedItem.args, actualCall.args, mode)
        ) {
          allowed = true;
          break;
        }
      }

      if (allowed) {
        hits.push(`Position ${i}: ${actualCall.name} is in allowed set`);
      } else {
        misses.push(`Position ${i}: ${actualCall.name} is not in allowed set`);
      }
    }

    const score = toolCalls.length > 0 ? hits.length / toolCalls.length : 1;

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: toolCalls.length,
    };
  }
}
