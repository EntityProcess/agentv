#!/usr/bin/env bun
/**
 * Tool Efficiency Scorer - Code Judge Plugin
 *
 * Evaluates agent efficiency based on execution metrics:
 * - Token usage relative to task complexity
 * - Number of tool calls (redundancy detection)
 * - Exploration ratio (read-only vs action tools)
 * - Cost efficiency
 *
 * Why this is a plugin (not built-in):
 * - Efficiency thresholds are domain-specific
 * - What's "efficient" depends on the task type
 * - Different projects have different cost/performance tradeoffs
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: efficiency
 *       type: code_judge
 *       script: bun run scripts/efficiency-scorer.ts
 *
 * Input (stdin JSON):
 *   - traceSummary: Tool call statistics
 *   - expectedOutcome: Task description (for complexity estimation)
 *
 * Output (stdout JSON):
 *   - score: 0.0-1.0 efficiency score
 *   - hits: Efficiency wins
 *   - misses: Efficiency issues
 *   - reasoning: Explanation
 */

interface TraceSummary {
  eventCount: number;
  toolCallsByName: Record<string, number>;
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

// Configurable thresholds (customize for your domain)
const THRESHOLDS = {
  // Maximum tool calls before penalty
  maxToolCalls: 10,
  // Ideal exploration ratio (read-only tools / total)
  targetExplorationRatio: 0.6,
  explorationTolerance: 0.2,
  // Token budgets
  maxTokensSimple: 2000,
  maxTokensComplex: 10000,
  // Cost thresholds (USD)
  maxCostSimple: 0.01,
  maxCostComplex: 0.1,
};

// Tools considered "exploration" (read-only)
const EXPLORATION_TOOLS = new Set([
  'read',
  'grep',
  'glob',
  'search',
  'list',
  'find',
  'get',
  'fetch',
  'query',
  'inspect',
  'view',
]);

function estimateTaskComplexity(expectedOutcome: string): 'simple' | 'complex' {
  const text = expectedOutcome.toLowerCase();
  const complexIndicators = [
    'multiple',
    'several',
    'comprehensive',
    'thorough',
    'analyze',
    'compare',
    'synthesize',
    'integrate',
  ];
  if (complexIndicators.some((indicator) => text.includes(indicator))) {
    return 'complex';
  }
  return 'simple';
}

function calculateExplorationRatio(traceSummary: TraceSummary): number {
  const toolCalls = traceSummary.toolCallsByName;
  const total = Object.values(toolCalls).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return 0;
  }

  let explorationCount = 0;
  for (const [tool, count] of Object.entries(toolCalls)) {
    const toolLower = tool.toLowerCase();
    if ([...EXPLORATION_TOOLS].some((exp) => toolLower.includes(exp))) {
      explorationCount += count;
    }
  }
  return explorationCount / total;
}

function evaluateEfficiency(
  traceSummary: TraceSummary | undefined,
  expectedOutcome: string,
): EvalOutput {
  const hits: string[] = [];
  const misses: string[] = [];
  const scores: number[] = [];

  const complexity = estimateTaskComplexity(expectedOutcome);

  // 1. Tool call count evaluation
  if (traceSummary) {
    const toolCount = traceSummary.eventCount;
    const maxCalls = THRESHOLDS.maxToolCalls;

    if (toolCount <= maxCalls) {
      hits.push(`Tool calls (${toolCount}) within budget (${maxCalls})`);
      scores.push(1.0);
    } else {
      const penalty = Math.min((toolCount - maxCalls) / maxCalls, 1.0);
      scores.push(1.0 - penalty);
      misses.push(`Excessive tool calls: ${toolCount} (budget: ${maxCalls})`);
    }

    // 2. Exploration ratio evaluation
    const expRatio = calculateExplorationRatio(traceSummary);
    const target = THRESHOLDS.targetExplorationRatio;
    const tolerance = THRESHOLDS.explorationTolerance;

    if (Math.abs(expRatio - target) <= tolerance) {
      hits.push(`Good exploration ratio: ${expRatio.toFixed(2)}`);
      scores.push(1.0);
    } else if (expRatio < target - tolerance) {
      scores.push(0.7);
      misses.push(`Low exploration ratio: ${expRatio.toFixed(2)} (target: ${target.toFixed(2)})`);
    } else {
      scores.push(0.7);
      misses.push(`High exploration ratio: ${expRatio.toFixed(2)} (target: ${target.toFixed(2)})`);
    }

    // 3. Token usage evaluation
    if (traceSummary.tokenUsage) {
      const tokens = traceSummary.tokenUsage;
      const totalTokens = tokens.input + tokens.output;
      const maxTokens =
        complexity === 'complex' ? THRESHOLDS.maxTokensComplex : THRESHOLDS.maxTokensSimple;

      if (totalTokens <= maxTokens) {
        hits.push(`Token usage (${totalTokens}) within budget`);
        scores.push(1.0);
      } else {
        const penalty = Math.min((totalTokens - maxTokens) / maxTokens, 1.0);
        scores.push(1.0 - penalty * 0.5); // Softer penalty
        misses.push(`High token usage: ${totalTokens} (budget: ${maxTokens})`);
      }
    }

    // 4. Cost evaluation
    if (traceSummary.costUsd !== undefined) {
      const cost = traceSummary.costUsd;
      const maxCost =
        complexity === 'complex' ? THRESHOLDS.maxCostComplex : THRESHOLDS.maxCostSimple;

      if (cost <= maxCost) {
        hits.push(`Cost ($${cost.toFixed(4)}) within budget`);
        scores.push(1.0);
      } else {
        scores.push(0.5);
        misses.push(`High cost: $${cost.toFixed(4)} (budget: $${maxCost.toFixed(4)})`);
      }
    }
  }

  // Calculate final score
  if (scores.length === 0) {
    return {
      score: 0.5,
      hits: ['No efficiency metrics available'],
      misses: [],
      reasoning: 'Could not evaluate efficiency - no metrics provided',
    };
  }

  const finalScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  const reasoning =
    `Task complexity: ${complexity}. ` +
    `Evaluated ${scores.length} efficiency criteria. ` +
    `Score: ${finalScore.toFixed(2)}`;

  return {
    score: Math.round(finalScore * 100) / 100,
    hits: hits.slice(0, 4),
    misses: misses.slice(0, 4),
    reasoning,
  };
}

async function main(): Promise<void> {
  try {
    const stdin = await Bun.stdin.text();
    const inputData = JSON.parse(stdin) as EvalInput;

    const traceSummary = inputData.traceSummary;
    const expectedOutcome = inputData.expectedOutcome ?? '';

    const result = evaluateEfficiency(traceSummary, expectedOutcome);

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const errorResult: EvalOutput = {
      score: 0,
      hits: [],
      misses: [`Evaluator error: ${error instanceof Error ? error.message : String(error)}`],
      reasoning: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

main();
