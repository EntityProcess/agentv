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
 *       script: ["bun", "run", "scripts/efficiency-scorer.ts"]
 */
import { type TraceSummary, defineCodeJudge } from '@agentv/eval';

// Configurable thresholds (customize for your domain)
const THRESHOLDS = {
  maxToolCalls: 10,
  targetExplorationRatio: 0.6,
  explorationTolerance: 0.2,
  maxTokensSimple: 2000,
  maxTokensComplex: 10000,
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

function estimateTaskComplexity(criteria: string): 'simple' | 'complex' {
  const text = criteria.toLowerCase();
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
  return complexIndicators.some((i) => text.includes(i)) ? 'complex' : 'simple';
}

function calculateExplorationRatio(traceSummary: TraceSummary): number {
  const toolCalls = traceSummary.toolCallsByName;
  const total = Object.values(toolCalls).reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;

  let explorationCount = 0;
  for (const [tool, count] of Object.entries(toolCalls)) {
    const toolLower = tool.toLowerCase();
    if ([...EXPLORATION_TOOLS].some((exp) => toolLower.includes(exp))) {
      explorationCount += count;
    }
  }
  return explorationCount / total;
}

export default defineCodeJudge(({ traceSummary, criteria }) => {
  const hits: string[] = [];
  const misses: string[] = [];
  const scores: number[] = [];

  const complexity = estimateTaskComplexity(criteria);

  if (!traceSummary) {
    return {
      score: 0.5,
      hits: ['No efficiency metrics available'],
      misses: [],
      reasoning: 'Could not evaluate efficiency - no metrics provided',
    };
  }

  // 1. Tool call count evaluation
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
      scores.push(1.0 - penalty * 0.5);
      misses.push(`High token usage: ${totalTokens} (budget: ${maxTokens})`);
    }
  }

  // 4. Cost evaluation
  if (traceSummary.costUsd !== undefined) {
    const cost = traceSummary.costUsd;
    const maxCost = complexity === 'complex' ? THRESHOLDS.maxCostComplex : THRESHOLDS.maxCostSimple;

    if (cost <= maxCost) {
      hits.push(`Cost ($${cost.toFixed(4)}) within budget`);
      scores.push(1.0);
    } else {
      scores.push(0.5);
      misses.push(`High cost: $${cost.toFixed(4)} (budget: $${maxCost.toFixed(4)})`);
    }
  }

  // Calculate final score
  const finalScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  return {
    score: Math.round(finalScore * 100) / 100,
    hits: hits.slice(0, 4),
    misses: misses.slice(0, 4),
    reasoning: `Task complexity: ${complexity}. Evaluated ${scores.length} criteria. Score: ${finalScore.toFixed(2)}`,
  };
});
