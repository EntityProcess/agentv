#!/usr/bin/env bun
/**
 * Tool Efficiency Scorer - Code Grader Plugin
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
 *   graders:
 *     - name: efficiency
 *       type: code_grader
 *       script: ["bun", "run", "scripts/efficiency-scorer.ts"]
 */
import { type TraceSummary, defineCodeGrader } from '@agentv/eval';

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

function calculateExplorationRatio(trace: TraceSummary): number {
  const toolCalls = trace.toolCalls;
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

export default defineCodeGrader(({ trace, criteria, tokenUsage, costUsd }) => {
  const assertions: Array<{ text: string; passed: boolean }> = [];
  const scores: number[] = [];

  const complexity = estimateTaskComplexity(criteria);

  if (!trace) {
    return {
      score: 0.5,
      assertions: [{ text: 'No efficiency metrics available', passed: true }],
    };
  }

  // 1. Tool call count evaluation
  const toolCount = trace.eventCount;
  const maxCalls = THRESHOLDS.maxToolCalls;

  if (toolCount <= maxCalls) {
    assertions.push({
      text: `Tool calls (${toolCount}) within budget (${maxCalls})`,
      passed: true,
    });
    scores.push(1.0);
  } else {
    const penalty = Math.min((toolCount - maxCalls) / maxCalls, 1.0);
    scores.push(1.0 - penalty);
    assertions.push({
      text: `Excessive tool calls: ${toolCount} (budget: ${maxCalls})`,
      passed: false,
    });
  }

  // 2. Exploration ratio evaluation
  const expRatio = calculateExplorationRatio(trace);
  const target = THRESHOLDS.targetExplorationRatio;
  const tolerance = THRESHOLDS.explorationTolerance;

  if (Math.abs(expRatio - target) <= tolerance) {
    assertions.push({ text: `Good exploration ratio: ${expRatio.toFixed(2)}`, passed: true });
    scores.push(1.0);
  } else if (expRatio < target - tolerance) {
    scores.push(0.7);
    assertions.push({
      text: `Low exploration ratio: ${expRatio.toFixed(2)} (target: ${target.toFixed(2)})`,
      passed: false,
    });
  } else {
    scores.push(0.7);
    assertions.push({
      text: `High exploration ratio: ${expRatio.toFixed(2)} (target: ${target.toFixed(2)})`,
      passed: false,
    });
  }

  // 3. Token usage evaluation
  if (tokenUsage) {
    const tokens = tokenUsage;
    const totalTokens = tokens.input + tokens.output;
    const maxTokens =
      complexity === 'complex' ? THRESHOLDS.maxTokensComplex : THRESHOLDS.maxTokensSimple;

    if (totalTokens <= maxTokens) {
      assertions.push({ text: `Token usage (${totalTokens}) within budget`, passed: true });
      scores.push(1.0);
    } else {
      const penalty = Math.min((totalTokens - maxTokens) / maxTokens, 1.0);
      scores.push(1.0 - penalty * 0.5);
      assertions.push({
        text: `High token usage: ${totalTokens} (budget: ${maxTokens})`,
        passed: false,
      });
    }
  }

  // 4. Cost evaluation
  if (costUsd !== undefined) {
    const cost = costUsd;
    const maxCost = complexity === 'complex' ? THRESHOLDS.maxCostComplex : THRESHOLDS.maxCostSimple;

    if (cost <= maxCost) {
      assertions.push({ text: `Cost ($${cost.toFixed(4)}) within budget`, passed: true });
      scores.push(1.0);
    } else {
      scores.push(0.5);
      assertions.push({
        text: `High cost: $${cost.toFixed(4)} (budget: $${maxCost.toFixed(4)})`,
        passed: false,
      });
    }
  }

  // Calculate final score
  const finalScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  return {
    score: Math.round(finalScore * 100) / 100,
    assertions: assertions.slice(0, 8),
  };
});
