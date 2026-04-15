import type { LatencyGraderConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

export interface LatencyGraderOptions {
  readonly config: LatencyGraderConfig;
}

/**
 * Grader that checks execution duration against a threshold.
 * Uses durationMs from the evaluation context.
 */
export class LatencyGrader implements Grader {
  readonly kind = 'latency';

  private readonly config: LatencyGraderConfig;

  constructor(options: LatencyGraderOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { threshold } = this.config;
    const durationMs = context.durationMs;

    // If no duration data available, we can't evaluate
    if (durationMs === undefined) {
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: 'No duration data available in trace', passed: false }],
        expectedAspectCount: 1,
        graderRawRequest: {
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
      assertions: [
        passed
          ? { text: `Duration ${durationMs}ms <= ${threshold}ms threshold`, passed: true }
          : { text: `Duration ${durationMs}ms > ${threshold}ms threshold`, passed: false },
      ],
      expectedAspectCount: 1,
      graderRawRequest: {
        type: 'latency',
        threshold,
        durationMs,
      },
    };
  }
}
