import type { RubricItem, RubricOperator } from '../types.js';

const OPERATOR_GUIDANCE: Record<RubricOperator, string> = {
  correctness:
    'Correctness: mark satisfied only when the answer positively supports or fulfills the outcome. Omission or contradiction should not satisfy it.',
  contradiction:
    'Contradiction guard: mark satisfied when the answer does not make a claim that contradicts the outcome. Do not require the answer to mention the outcome; mark unsatisfied only for incompatible claims.',
};

export function formatRubricOperatorLabel(operator: RubricOperator | undefined): string {
  return operator ? ` (operator: ${operator})` : '';
}

export function formatRubricOperatorGuidance(rubrics: readonly RubricItem[]): readonly string[] {
  const operators = new Set<RubricOperator>();
  for (const rubric of rubrics) {
    if (rubric.operator) {
      operators.add(rubric.operator);
    }
  }

  if (operators.size === 0) {
    return [];
  }

  return [...operators].map((operator) => OPERATOR_GUIDANCE[operator]);
}
