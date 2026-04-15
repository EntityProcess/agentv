import { explorationRatio } from '../trace.js';
import type { AssertionEntry, ExecutionMetricsGraderConfig } from '../types.js';
import { scoreToVerdict } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

export interface ExecutionMetricsGraderOptions {
  readonly config: ExecutionMetricsGraderConfig;
}

/**
 * Grader that checks execution metrics against configured thresholds.
 * Supports multiple threshold types: tool calls, LLM calls, tokens, cost, duration,
 * and exploration ratio. Only specified thresholds are checked.
 *
 * Score is proportional: passed / total assertions
 */
export class ExecutionMetricsGrader implements Grader {
  readonly kind = 'execution-metrics';

  private readonly config: ExecutionMetricsGraderConfig;

  constructor(options: ExecutionMetricsGraderOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { trace, tokenUsage, costUsd, durationMs } = context;
    const {
      max_tool_calls,
      max_llm_calls,
      max_tokens,
      max_cost_usd,
      max_duration_ms,
      target_exploration_ratio,
      exploration_tolerance = 0.2,
    } = this.config;

    // Guard: need trace for tool-specific checks
    const needsTrace =
      max_tool_calls !== undefined ||
      max_llm_calls !== undefined ||
      target_exploration_ratio !== undefined;
    if (needsTrace && !trace) {
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: 'No trace summary available', passed: false }],
        expectedAspectCount: 1,
        graderRawRequest: {
          type: 'execution-metrics',
          config: this.extractConfiguredThresholds(),
          actual: null,
        },
      };
    }

    // After the guard, trace is guaranteed to be defined when needed
    const narrowedTrace = trace;

    const assertions: AssertionEntry[] = [];
    const actualMetrics: Record<string, number | undefined> = {};

    // Check max_tool_calls
    if (max_tool_calls !== undefined && narrowedTrace) {
      const toolCalls = narrowedTrace.eventCount;
      actualMetrics.tool_calls = toolCalls;

      if (toolCalls <= max_tool_calls) {
        assertions.push({ text: `Tool calls ${toolCalls} <= ${max_tool_calls} max`, passed: true });
      } else {
        assertions.push({ text: `Tool calls ${toolCalls} > ${max_tool_calls} max`, passed: false });
      }
    }

    // Check max_llm_calls
    if (max_llm_calls !== undefined && narrowedTrace) {
      const llmCalls = narrowedTrace.llmCallCount;

      if (llmCalls === undefined) {
        assertions.push({ text: 'LLM call count data not available', passed: false });
      } else {
        actualMetrics.llm_calls = llmCalls;

        if (llmCalls <= max_llm_calls) {
          assertions.push({ text: `LLM calls ${llmCalls} <= ${max_llm_calls} max`, passed: true });
        } else {
          assertions.push({ text: `LLM calls ${llmCalls} > ${max_llm_calls} max`, passed: false });
        }
      }
    }

    // Check max_tokens
    if (max_tokens !== undefined) {
      if (!tokenUsage) {
        assertions.push({ text: 'Token usage data not available', passed: false });
      } else {
        const totalTokens = tokenUsage.input + tokenUsage.output;
        actualMetrics.tokens = totalTokens;

        if (totalTokens <= max_tokens) {
          assertions.push({
            text: `Total tokens ${totalTokens} <= ${max_tokens} max`,
            passed: true,
          });
        } else {
          assertions.push({
            text: `Total tokens ${totalTokens} > ${max_tokens} max`,
            passed: false,
          });
        }
      }
    }

    // Check max_cost_usd
    if (max_cost_usd !== undefined) {
      if (costUsd === undefined) {
        assertions.push({ text: 'Cost data not available', passed: false });
      } else {
        actualMetrics.cost_usd = costUsd;

        const formatCost = (n: number) => `$${n.toFixed(4)}`;
        if (costUsd <= max_cost_usd) {
          assertions.push({
            text: `Cost ${formatCost(costUsd)} <= ${formatCost(max_cost_usd)} max`,
            passed: true,
          });
        } else {
          assertions.push({
            text: `Cost ${formatCost(costUsd)} > ${formatCost(max_cost_usd)} max`,
            passed: false,
          });
        }
      }
    }

    // Check max_duration_ms
    if (max_duration_ms !== undefined) {
      if (durationMs === undefined) {
        assertions.push({ text: 'Duration data not available', passed: false });
      } else {
        actualMetrics.duration_ms = durationMs;

        if (durationMs <= max_duration_ms) {
          assertions.push({
            text: `Duration ${durationMs}ms <= ${max_duration_ms}ms max`,
            passed: true,
          });
        } else {
          assertions.push({
            text: `Duration ${durationMs}ms > ${max_duration_ms}ms max`,
            passed: false,
          });
        }
      }
    }

    // Check target_exploration_ratio
    if (target_exploration_ratio !== undefined && narrowedTrace) {
      const ratio = explorationRatio(narrowedTrace);

      if (ratio === undefined) {
        assertions.push({ text: 'Exploration ratio not available (no tool calls)', passed: false });
      } else {
        actualMetrics.exploration_ratio = ratio;

        const diff = Math.abs(ratio - target_exploration_ratio);
        if (diff <= exploration_tolerance) {
          assertions.push({
            text: `Exploration ratio ${ratio.toFixed(2)} within tolerance of target ${target_exploration_ratio}`,
            passed: true,
          });
        } else {
          assertions.push({
            text: `Exploration ratio ${ratio.toFixed(2)} outside tolerance of target ${target_exploration_ratio} (diff: ${diff.toFixed(2)}, tolerance: ${exploration_tolerance})`,
            passed: false,
          });
        }
      }
    }

    // Calculate score as proportion of passed assertions
    const totalChecks = assertions.length;
    const passedCount = assertions.filter((a) => a.passed).length;
    const score = totalChecks > 0 ? passedCount / totalChecks : 0;

    return {
      score,
      verdict: scoreToVerdict(score),
      assertions,
      expectedAspectCount: totalChecks || 1,
      graderRawRequest: {
        type: 'execution-metrics',
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
