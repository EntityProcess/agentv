#!/usr/bin/env bun
/**
 * Check Metrics Present - Code Judge Plugin
 *
 * Verifies that execution metrics are present in the traceSummary.
 * This is a simple sanity check that metrics collection is working.
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: metrics-present
 *       type: code_judge
 *       script: bun run scripts/check-metrics-present.ts
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

    const summary = input.traceSummary;

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
    if (summary.tokenUsage) {
      hits.push(`tokenUsage present: ${summary.tokenUsage.input}/${summary.tokenUsage.output}`);
    } else {
      misses.push('tokenUsage not present');
    }

    // Check for costUsd
    if (summary.costUsd !== undefined) {
      hits.push(`costUsd present: $${summary.costUsd.toFixed(4)}`);
    } else {
      misses.push('costUsd not present');
    }

    // Check for durationMs
    if (summary.durationMs !== undefined) {
      hits.push(`durationMs present: ${summary.durationMs}ms`);
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
