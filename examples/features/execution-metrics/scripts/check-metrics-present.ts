#!/usr/bin/env bun
/**
 * Check Metrics Present - Code Judge Plugin
 *
 * Verifies that execution metrics are present in the trace_summary payload.
 * This is a simple sanity check that metrics collection is working.
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: metrics-present
 *       type: code_judge
 *       script: ["bun", "run", "../scripts/check-metrics-present.ts"]
 */

interface SnakeTraceSummary {
  event_count: number;
  tool_names: string[];
  tool_calls_by_name: Record<string, number>;
  error_count: number;
  token_usage?: { input: number; output: number; cached?: number };
  cost_usd?: number;
  duration_ms?: number;
}

interface EvalInput {
  trace_summary?: SnakeTraceSummary;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

async function main(): Promise<void> {
  try {
    const stdin = await Bun.stdin.text();
    const input = JSON.parse(stdin) as EvalInput;

    const hits: string[] = [];
    const misses: string[] = [];

    const summary = input.trace_summary;

    if (!summary) {
      console.log(
        JSON.stringify({
          score: 0,
          hits: [],
          misses: ['No traceSummary provided'],
          reasoning: 'Execution metrics collection failed - no traceSummary',
        }),
      );
      return;
    }

    // Check for tokenUsage
    if (summary.token_usage) {
      hits.push(`tokenUsage present: ${summary.token_usage.input}/${summary.token_usage.output}`);
    } else {
      misses.push('tokenUsage not present');
    }

    // Check for costUsd
    if (summary.cost_usd !== undefined) {
      hits.push(`costUsd present: $${summary.cost_usd.toFixed(4)}`);
    } else {
      misses.push('costUsd not present');
    }

    // Check for durationMs
    if (summary.duration_ms !== undefined) {
      hits.push(`durationMs present: ${summary.duration_ms}ms`);
    } else {
      misses.push('durationMs not present');
    }

    const score = hits.length / (hits.length + misses.length);

    const result: EvalOutput = {
      score,
      hits,
      misses,
      reasoning: `Checked 3 metric fields: ${hits.length} present, ${misses.length} missing`,
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: [`Error: ${error instanceof Error ? error.message : String(error)}`],
        reasoning: 'Script execution failed',
      }),
    );
    process.exit(1);
  }
}

main();
