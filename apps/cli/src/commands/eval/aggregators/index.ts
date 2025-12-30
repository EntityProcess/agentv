import type { EvaluationResult } from '@agentv/core';

import {
  type ConfusionMatrixResult,
  aggregateConfusionMatrix,
  formatConfusionMatrixSummary,
} from './confusion-matrix.js';

export type { ConfusionMatrixResult };

/**
 * Supported built-in aggregator types.
 */
export type AggregatorType = 'confusion-matrix';

/**
 * Union of all aggregator results.
 */
export interface AggregatorOutput {
  readonly type: AggregatorType;
  readonly result: ConfusionMatrixResult;
}

/**
 * Run a built-in aggregator on evaluation results.
 */
export function runAggregator(
  type: AggregatorType,
  results: readonly EvaluationResult[],
): AggregatorOutput {
  switch (type) {
    case 'confusion-matrix':
      return {
        type: 'confusion-matrix',
        result: aggregateConfusionMatrix(results),
      };
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown aggregator type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Format aggregator output for terminal display.
 */
export function formatAggregatorOutput(output: AggregatorOutput): string {
  switch (output.type) {
    case 'confusion-matrix':
      return formatConfusionMatrixSummary(output.result);
    default: {
      const exhaustiveCheck: never = output.type;
      throw new Error(`Unknown aggregator type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Check if a string is a valid built-in aggregator type.
 */
export function isBuiltinAggregator(value: string): value is AggregatorType {
  return value === 'confusion-matrix';
}
