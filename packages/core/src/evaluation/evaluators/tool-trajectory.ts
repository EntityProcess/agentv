import type { OutputMessage } from '../providers/types.js';
import type {
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
 * Check if actual args match expected args.
 * - 'any' → always matches
 * - object → partial match (only specified keys, deep equality)
 */
function argsMatch(
  expected: ToolTrajectoryExpectedItem['args'],
  actual: Record<string, unknown> | undefined,
): boolean {
  // No args constraint means match
  if (expected === undefined) return true;
  // 'any' means skip validation
  if (expected === 'any') return true;
  // Partial match: check only specified keys
  if (actual === undefined) return false;
  for (const key of Object.keys(expected)) {
    if (!Object.hasOwn(actual, key)) return false;
    if (!deepEqual(expected[key], actual[key])) return false;
  }
  return true;
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
    const { outputMessages, traceSummary } = context;

    // Extract tool calls from outputMessages (primary source)
    const toolCalls = this.extractToolCallsFromMessages(outputMessages);

    // Handle missing tool calls
    if (toolCalls.length === 0 && !traceSummary) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No trace available for evaluation'],
        expectedAspectCount: 1,
      };
    }

    // Build summary from tool calls if available, otherwise use provided summary
    const summary = toolCalls.length > 0 ? this.buildSummary(toolCalls) : traceSummary;

    if (!summary) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No trace available for evaluation'],
        expectedAspectCount: 1,
      };
    }

    switch (this.config.mode) {
      case 'any_order':
        return this.evaluateAnyOrder(summary);
      case 'in_order':
        return this.evaluateInOrder(toolCalls);
      case 'exact':
        return this.evaluateExact(toolCalls);
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
    messages: readonly OutputMessage[] | undefined,
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
        hits.push(`${toolName}: called ${actual} times (required ≥${required})`);
      } else {
        misses.push(`${toolName}: called ${actual} times (required ≥${required})`);
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
      let found = false;
      let argsMismatch = false;
      let matchedCall: ExtractedToolCall | undefined;

      while (actualIndex < toolCalls.length) {
        const actualCall = toolCalls[actualIndex];
        if (actualCall.name === expectedTool) {
          // Tool name matches, check args if specified
          if (argsMatch(expectedItem.args, actualCall.args)) {
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
      let sequenceMatched = false;

      if (actualTool === expectedTool) {
        // Tool name matches, check args if specified
        if (argsMatch(expectedItem.args, actualCall.args)) {
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
}
