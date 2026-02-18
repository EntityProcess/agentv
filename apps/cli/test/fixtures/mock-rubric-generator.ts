/**
 * Mock rubric generator for testing the generate rubrics command.
 * This file is loaded by the CLI when AGENTEVO_CLI_RUBRIC_GENERATOR is set.
 */

import type { GenerateRubricsOptions } from '@agentv/core';
import type { RubricItem } from '@agentv/core';

/**
 * Mock implementation of generateRubrics that returns deterministic test rubrics.
 */
export async function generateRubrics(
  options: GenerateRubricsOptions,
): Promise<readonly RubricItem[]> {
  // Return mock rubrics based on the expected outcome
  const { expectedOutcome } = options;

  // Generate deterministic rubrics for testing
  return [
    {
      id: 'completeness',
      outcome: `Answer must address all aspects of: ${expectedOutcome}`,
      weight: 0.4,
      required: true,
    },
    {
      id: 'accuracy',
      outcome: 'Answer must be factually correct',
      weight: 0.3,
      required: true,
    },
    {
      id: 'clarity',
      outcome: 'Answer must be clear and well-structured',
      weight: 0.2,
      required: false,
    },
    {
      id: 'conciseness',
      outcome: 'Answer must be concise without unnecessary details',
      weight: 0.1,
      required: false,
    },
  ];
}
