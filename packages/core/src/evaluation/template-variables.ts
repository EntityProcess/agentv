/**
 * Template variable constants for evaluator prompts.
 * These variables can be used in custom evaluator templates with {{ variable_name }} syntax.
 */
export const TEMPLATE_VARIABLES = {
  /** @deprecated Use OUTPUT_TEXT instead */
  ANSWER: 'answer',
  EXPECTED_OUTPUT: 'expected_output',
  /** @deprecated Use INPUT_TEXT instead */
  QUESTION: 'question',
  CRITERIA: 'criteria',
  /** @deprecated Use EXPECTED_OUTPUT_TEXT instead */
  REFERENCE_ANSWER: 'reference_answer',
  INPUT: 'input',
  OUTPUT: 'output',
  FILE_CHANGES: 'file_changes',
  INPUT_TEXT: 'input_text',
  OUTPUT_TEXT: 'output_text',
  EXPECTED_OUTPUT_TEXT: 'expected_output_text',
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
  TEMPLATE_VARIABLES.ANSWER,
  TEMPLATE_VARIABLES.EXPECTED_OUTPUT,
  TEMPLATE_VARIABLES.OUTPUT_TEXT,
]);
