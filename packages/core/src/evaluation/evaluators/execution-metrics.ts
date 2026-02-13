import { explorationRatio } from '../trace.js';
import type { ExecutionMetricsEvaluatorConfig } from '../types.js';
import { scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

export interface ExecutionMetricsEvaluatorOptions {
  readonly config: ExecutionMetricsEvaluatorConfig;
}

/**
 * Evaluator that checks execution metrics against configured thresholds.
 * Supports multiple threshold types: tool calls, LLM calls, tokens, cost, duration,
 * and exploration ratio. Only specified thresholds are checked.
 *
 * Score is proportional: hits.length / (hits.length + misses.length)
 */
export class ExecutionMetricsEvaluator implements Evaluator {
  readonly kind = 'execution_metrics';

  private readonly config: ExecutionMetricsEvaluatorConfig;

  constructor(options: ExecutionMetricsEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { traceSummary } = context;
    const {
      max_tool_calls,
      max_llm_calls,
      max_tokens,
      max_cost_usd,
      max_duration_ms,
      target_exploration_ratio,
      exploration_tolerance = 0.2,
    } = this.config;

    // If no trace summary, we can't evaluate
    if (!traceSummary) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No trace summary available'],
        expectedAspectCount: 1,
        reasoning: 'Execution metrics not available - no trace summary provided',
        evaluatorRawRequest: {
          type: 'execution_metrics',
          config: this.extractConfiguredThresholds(),
          actual: null,
        },
      };
    }

    const hits: string[] = [];
    const misses: string[] = [];
    const actualMetrics: Record<string, number | undefined> = {};

    // Check max_tool_calls
    if (max_tool_calls !== undefined) {
      const toolCalls = traceSummary.eventCount;
      actualMetrics.tool_calls = toolCalls;

      if (toolCalls <= max_tool_calls) {
        hits.push(`Tool calls ${toolCalls} <= ${max_tool_calls} max`);
      } else {
        misses.push(`Tool calls ${toolCalls} > ${max_tool_calls} max`);
      }
    }

    // Check max_llm_calls
    if (max_llm_calls !== undefined) {
      const llmCalls = traceSummary.llmCallCount;

      if (llmCalls === undefined) {
        misses.push('LLM call count data not available');
      } else {
        actualMetrics.llm_calls = llmCalls;

        if (llmCalls <= max_llm_calls) {
          hits.push(`LLM calls ${llmCalls} <= ${max_llm_calls} max`);
        } else {
          misses.push(`LLM calls ${llmCalls} > ${max_llm_calls} max`);
        }
      }
    }

    // Check max_tokens
    if (max_tokens !== undefined) {
      const tokenUsage = traceSummary.tokenUsage;

      if (!tokenUsage) {
        misses.push('Token usage data not available');
      } else {
        const totalTokens = tokenUsage.input + tokenUsage.output;
        actualMetrics.tokens = totalTokens;

        if (totalTokens <= max_tokens) {
          hits.push(`Total tokens ${totalTokens} <= ${max_tokens} max`);
        } else {
          misses.push(`Total tokens ${totalTokens} > ${max_tokens} max`);
        }
      }
    }

    // Check max_cost_usd
    if (max_cost_usd !== undefined) {
      const costUsd = traceSummary.costUsd;

      if (costUsd === undefined) {
        misses.push('Cost data not available');
      } else {
        actualMetrics.cost_usd = costUsd;

        const formatCost = (n: number) => `$${n.toFixed(4)}`;
        if (costUsd <= max_cost_usd) {
          hits.push(`Cost ${formatCost(costUsd)} <= ${formatCost(max_cost_usd)} max`);
        } else {
          misses.push(`Cost ${formatCost(costUsd)} > ${formatCost(max_cost_usd)} max`);
        }
      }
    }

    // Check max_duration_ms
    if (max_duration_ms !== undefined) {
      const durationMs = traceSummary.durationMs;

      if (durationMs === undefined) {
        misses.push('Duration data not available');
      } else {
        actualMetrics.duration_ms = durationMs;

        if (durationMs <= max_duration_ms) {
          hits.push(`Duration ${durationMs}ms <= ${max_duration_ms}ms max`);
        } else {
          misses.push(`Duration ${durationMs}ms > ${max_duration_ms}ms max`);
        }
      }
    }

    // Check target_exploration_ratio
    if (target_exploration_ratio !== undefined) {
      const ratio = explorationRatio(traceSummary);

      if (ratio === undefined) {
        misses.push('Exploration ratio not available (no tool calls)');
      } else {
        actualMetrics.exploration_ratio = ratio;

        const diff = Math.abs(ratio - target_exploration_ratio);
        if (diff <= exploration_tolerance) {
          hits.push(
            `Exploration ratio ${ratio.toFixed(2)} within tolerance of target ${target_exploration_ratio}`,
          );
        } else {
          misses.push(
            `Exploration ratio ${ratio.toFixed(2)} outside tolerance of target ${target_exploration_ratio} (diff: ${diff.toFixed(2)}, tolerance: ${exploration_tolerance})`,
          );
        }
      }
    }

    // Calculate score as proportion of hits
    const totalChecks = hits.length + misses.length;
    const score = totalChecks > 0 ? hits.length / totalChecks : 0;

    // Build reasoning
    const reasoningParts: string[] = [];
    if (actualMetrics.tool_calls !== undefined) {
      reasoningParts.push(`tool_calls=${actualMetrics.tool_calls}`);
    }
    if (actualMetrics.llm_calls !== undefined) {
      reasoningParts.push(`llm_calls=${actualMetrics.llm_calls}`);
    }
    if (actualMetrics.tokens !== undefined) {
      reasoningParts.push(`tokens=${actualMetrics.tokens}`);
    }
    if (actualMetrics.cost_usd !== undefined) {
      reasoningParts.push(`cost=$${actualMetrics.cost_usd.toFixed(4)}`);
    }
    if (actualMetrics.duration_ms !== undefined) {
      reasoningParts.push(`duration=${actualMetrics.duration_ms}ms`);
    }
    if (actualMetrics.exploration_ratio !== undefined) {
      reasoningParts.push(`exploration_ratio=${actualMetrics.exploration_ratio.toFixed(2)}`);
    }

    const reasoning =
      reasoningParts.length > 0
        ? `execution_metrics ${reasoningParts.join(', ')}`
        : 'No metrics evaluated';

    return {
      score,
      verdict: scoreToVerdict(score),
      hits,
      misses,
      expectedAspectCount: totalChecks || 1,
      reasoning,
      evaluatorRawRequest: {
        type: 'execution_metrics',
        config: this.extractConfiguredThresholds(),
        actual: this.filterDefinedMetrics(actualMetrics),
      },
    };
  }

  private extractConfiguredThresholds(): Record<string, number> {
    const thresholds: Record<string, number> = {};

    if (this.config.max_tool_calls !== undefined) {
      thresholds.max_tool_calls = this.config.max_tool_calls;
    }
    if (this.config.max_llm_calls !== undefined) {
      thresholds.max_llm_calls = this.config.max_llm_calls;
    }
    if (this.config.max_tokens !== undefined) {
      thresholds.max_tokens = this.config.max_tokens;
    }
    if (this.config.max_cost_usd !== undefined) {
      thresholds.max_cost_usd = this.config.max_cost_usd;
    }
    if (this.config.max_duration_ms !== undefined) {
      thresholds.max_duration_ms = this.config.max_duration_ms;
    }
    if (this.config.target_exploration_ratio !== undefined) {
      thresholds.target_exploration_ratio = this.config.target_exploration_ratio;
      thresholds.exploration_tolerance = this.config.exploration_tolerance ?? 0.2;
    }

    return thresholds;
  }

  private filterDefinedMetrics(
    metrics: Record<string, number | undefined>,
  ): Record<string, number> | null {
    const defined: Record<string, number> = {};
    let hasAny = false;

    for (const [key, value] of Object.entries(metrics)) {
      if (value !== undefined) {
        defined[key] = value;
        hasAny = true;
      }
    }

    return hasAny ? defined : null;
  }
}
