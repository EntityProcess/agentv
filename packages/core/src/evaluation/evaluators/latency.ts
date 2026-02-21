import type { LatencyEvaluatorConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

export interface LatencyEvaluatorOptions {
  readonly config: LatencyEvaluatorConfig;
}

/**
 * Evaluator that checks execution duration against a threshold.
 * Uses trace.durationMs from the evaluation context.
 */
export class LatencyEvaluator implements Evaluator {
  readonly kind = 'latency';

  private readonly config: LatencyEvaluatorConfig;

  constructor(options: LatencyEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { threshold } = this.config;
    const durationMs = context.trace?.durationMs;

    // If no duration data available, we can't evaluate
    if (durationMs === undefined) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: ['No duration data available in trace'],
        expectedAspectCount: 1,
        reasoning: 'Execution duration not reported by provider',
        evaluatorRawRequest: {
          type: 'latency',
          threshold,
          durationMs: null,
        },
      };
    }

    const passed = durationMs <= threshold;
    const score = passed ? 1 : 0;

    return {
      score,
      verdict: passed ? 'pass' : 'fail',
      hits: passed ? [`Duration ${durationMs}ms <= ${threshold}ms threshold`] : [],
      misses: passed ? [] : [`Duration ${durationMs}ms > ${threshold}ms threshold`],
      expectedAspectCount: 1,
      reasoning: `Execution took ${durationMs}ms (threshold: ${threshold}ms)`,
      evaluatorRawRequest: {
        type: 'latency',
        threshold,
        durationMs,
      },
    };
  }
}
