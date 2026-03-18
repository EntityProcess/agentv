import type { CostEvaluatorConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

export interface CostEvaluatorOptions {
  readonly config: CostEvaluatorConfig;
}

/**
 * Evaluator that checks execution cost against a budget.
 * Uses costUsd from the evaluation context.
 */
export class CostEvaluator implements Evaluator {
  readonly kind = 'cost';

  private readonly config: CostEvaluatorConfig;

  constructor(options: CostEvaluatorOptions) {
    this.config = options.config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const { budget } = this.config;
    const costUsd = context.costUsd;

    // If no cost data available, we can't evaluate
    if (costUsd === undefined) {
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: 'No cost data available in trace', passed: false }],
        expectedAspectCount: 1,
        evaluatorRawRequest: {
          type: 'cost',
          budget,
          costUsd: null,
        },
      };
    }

    const passed = costUsd <= budget;
    const score = passed ? 1 : 0;

    // Format cost for display
    const formatCost = (n: number) => `$${n.toFixed(4)}`;

    return {
      score,
      verdict: passed ? 'pass' : 'fail',
      assertions: [
        passed
          ? { text: `Cost ${formatCost(costUsd)} <= ${formatCost(budget)} budget`, passed: true }
          : { text: `Cost ${formatCost(costUsd)} > ${formatCost(budget)} budget`, passed: false },
      ],
      expectedAspectCount: 1,
      evaluatorRawRequest: {
        type: 'cost',
        budget,
        costUsd,
      },
    };
  }
}
