#!/usr/bin/env bun
/**
 * Efficiency Check - Code Judge for Execution Metrics
 *
 * Demonstrates how to evaluate agent efficiency using execution metrics
 * available in the trace_summary payload.
 *
 * Input (stdin JSON):
 *   - trace_summary: Contains execution metrics when available
 *     - event_count: Number of tool calls
 *     - token_usage?: { input, output, cached? }
 *     - cost_usd?: API cost
 *     - duration_ms?: Execution time
 *
 * Output (stdout JSON):
 *   - score: 0.0-1.0
 *   - hits: Efficiency wins
 *   - misses: Efficiency issues
 *   - reasoning: Explanation
 */

interface TraceSummary {
  event_count: number;
  tool_names: string[];
  tool_calls_by_name: Record<string, number>;
  error_count: number;
  token_usage?: { input: number; output: number; cached?: number };
  cost_usd?: number;
  duration_ms?: number;
}

interface EvalInput {
  trace_summary?: TraceSummary;
  expected_outcome?: string;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

// Configurable thresholds
const THRESHOLDS = {
  maxToolCalls: 5,
  maxTokens: 2000,
  maxCostUsd: 0.01,
  maxDurationMs: 10000,
};

function checkEfficiency(input: EvalInput): EvalOutput {
  const hits: string[] = [];
  const misses: string[] = [];
  const checks: boolean[] = [];

  const summary = input.trace_summary;

  if (!summary) {
    return {
      score: 0.5,
      hits: [],
      misses: ['No trace summary available'],
      reasoning: 'Cannot evaluate efficiency without trace data',
    };
  }

  // Check tool call count
  if (summary.event_count <= THRESHOLDS.maxToolCalls) {
    hits.push(`Tool calls (${summary.event_count}) within limit (${THRESHOLDS.maxToolCalls})`);
    checks.push(true);
  } else {
    misses.push(`Too many tool calls: ${summary.event_count} (max: ${THRESHOLDS.maxToolCalls})`);
    checks.push(false);
  }

  // Check token usage if available
  if (summary.token_usage) {
    const totalTokens = summary.token_usage.input + summary.token_usage.output;
    if (totalTokens <= THRESHOLDS.maxTokens) {
      hits.push(`Token usage (${totalTokens}) within limit`);
      checks.push(true);
    } else {
      misses.push(`High token usage: ${totalTokens} (max: ${THRESHOLDS.maxTokens})`);
      checks.push(false);
    }
  }

  // Check cost if available
  if (summary.cost_usd !== undefined) {
    if (summary.cost_usd <= THRESHOLDS.maxCostUsd) {
      hits.push(`Cost ($${summary.cost_usd.toFixed(4)}) within budget`);
      checks.push(true);
    } else {
      misses.push(`High cost: $${summary.cost_usd.toFixed(4)} (max: $${THRESHOLDS.maxCostUsd})`);
      checks.push(false);
    }
  }

  // Check duration if available
  if (summary.duration_ms !== undefined) {
    if (summary.duration_ms <= THRESHOLDS.maxDurationMs) {
      hits.push(`Duration (${summary.duration_ms}ms) within limit`);
      checks.push(true);
    } else {
      misses.push(
        `Slow execution: ${summary.duration_ms}ms (max: ${THRESHOLDS.maxDurationMs}ms)`,
      );
      checks.push(false);
    }
  }

  // Calculate score
  const passCount = checks.filter((c) => c).length;
  const score = checks.length > 0 ? passCount / checks.length : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    hits: hits.slice(0, 4),
    misses: misses.slice(0, 4),
    reasoning: `Checked ${checks.length} efficiency metrics: ${passCount} passed, ${checks.length - passCount} failed`,
  };
}

async function main(): Promise<void> {
  try {
    const stdin = await Bun.stdin.text();
    const input = JSON.parse(stdin) as EvalInput;
    const result = checkEfficiency(input);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const errorResult: EvalOutput = {
      score: 0,
      hits: [],
      misses: [`Error: ${error instanceof Error ? error.message : String(error)}`],
      reasoning: 'Evaluation failed due to error',
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

main();
