#!/usr/bin/env bun
/**
 * Efficiency Check - Code Judge for Execution Metrics
 *
 * Demonstrates how to evaluate agent efficiency using execution metrics
 * available in the TraceSummary.
 *
 * Input (stdin JSON):
 *   - traceSummary: Contains execution metrics when available
 *     - eventCount: Number of tool calls
 *     - tokenUsage?: { input, output, cached? }
 *     - costUsd?: API cost
 *     - durationMs?: Execution time
 *
 * Output (stdout JSON):
 *   - score: 0.0-1.0
 *   - hits: Efficiency wins
 *   - misses: Efficiency issues
 *   - reasoning: Explanation
 */

interface TraceSummary {
  eventCount: number;
  toolNames: string[];
  toolCallsByName: Record<string, number>;
  errorCount: number;
  tokenUsage?: { input: number; output: number; cached?: number };
  costUsd?: number;
  durationMs?: number;
}

interface EvalInput {
  traceSummary?: TraceSummary;
  expectedOutcome?: string;
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

  const summary = input.traceSummary;

  if (!summary) {
    return {
      score: 0.5,
      hits: [],
      misses: ['No trace summary available'],
      reasoning: 'Cannot evaluate efficiency without trace data',
    };
  }

  // Check tool call count
  if (summary.eventCount <= THRESHOLDS.maxToolCalls) {
    hits.push(`Tool calls (${summary.eventCount}) within limit (${THRESHOLDS.maxToolCalls})`);
    checks.push(true);
  } else {
    misses.push(`Too many tool calls: ${summary.eventCount} (max: ${THRESHOLDS.maxToolCalls})`);
    checks.push(false);
  }

  // Check token usage if available
  if (summary.tokenUsage) {
    const totalTokens = summary.tokenUsage.input + summary.tokenUsage.output;
    if (totalTokens <= THRESHOLDS.maxTokens) {
      hits.push(`Token usage (${totalTokens}) within limit`);
      checks.push(true);
    } else {
      misses.push(`High token usage: ${totalTokens} (max: ${THRESHOLDS.maxTokens})`);
      checks.push(false);
    }
  }

  // Check cost if available
  if (summary.costUsd !== undefined) {
    if (summary.costUsd <= THRESHOLDS.maxCostUsd) {
      hits.push(`Cost ($${summary.costUsd.toFixed(4)}) within budget`);
      checks.push(true);
    } else {
      misses.push(`High cost: $${summary.costUsd.toFixed(4)} (max: $${THRESHOLDS.maxCostUsd})`);
      checks.push(false);
    }
  }

  // Check duration if available
  if (summary.durationMs !== undefined) {
    if (summary.durationMs <= THRESHOLDS.maxDurationMs) {
      hits.push(`Duration (${summary.durationMs}ms) within limit`);
      checks.push(true);
    } else {
      misses.push(`Slow execution: ${summary.durationMs}ms (max: ${THRESHOLDS.maxDurationMs}ms)`);
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
