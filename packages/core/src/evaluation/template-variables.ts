/**
 * Template variable constants for evaluator prompts.
 * These variables can be used in custom evaluator templates with {{ variable_name }} syntax.
 */
export const TEMPLATE_VARIABLES = {
  CANDIDATE_ANSWER: 'candidate_answer',
  EXPECTED_OUTPUT: 'expected_output',
  QUESTION: 'question',
  CRITERIA: 'criteria',
  REFERENCE_ANSWER: 'reference_answer',
  INPUT: 'input',
  OUTPUT_MESSAGES: 'output_messages',
  FILE_CHANGES: 'file_changes',
} as const;

/**
 * Type representing all valid template variable names.
 */
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[keyof typeof TEMPLATE_VARIABLES];

/**
 * Set of all valid template variable names for runtime validation.
 */
export const VALID_TEMPLATE_VARIABLES = new Set<string>(Object.values(TEMPLATE_VARIABLES));

/**
 * Template variables that are required for meaningful evaluation.
 * At least one of these should be present in a custom evaluator template.
 */
export const REQUIRED_TEMPLATE_VARIABLES = new Set<string>([
  TEMPLATE_VARIABLES.CANDIDATE_ANSWER,
  TEMPLATE_VARIABLES.EXPECTED_OUTPUT,
]);
