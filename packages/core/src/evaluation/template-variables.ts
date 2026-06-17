/**
 * Template variable constants for evaluator prompts.
 * These variables can be used in custom grader templates with {{ variable_name }} syntax.
 *
 * Primary variables:
 *   - {{ input }}           — input as plain text (single-turn) or role-prefixed conversation (multi-turn)
 *   - {{ output }}          — last assistant message as plain text
 *   - {{ expected_output }} — reference answer as plain text
 *   - {{ criteria }}        — evaluation criteria string
 *   - {{ metadata }}        — per-test metadata as formatted JSON
 *   - {{ metadata_json }}   — per-test metadata as compact JSON
 *   - {{ rubrics }}        — llm-grader rubrics as formatted JSON
 *   - {{ rubrics_json }}   — llm-grader rubrics as compact JSON
 *   - {{ file_changes }}    — file diff (if available)
 *   - {{ tool_calls }}     — formatted summary of tool calls from agent execution
 *
 */
export const TEMPLATE_VARIABLES = {
  EXPECTED_OUTPUT: 'expected_output',
  CRITERIA: 'criteria',
  METADATA: 'metadata',
  METADATA_JSON: 'metadata_json',
  RUBRICS: 'rubrics',
  RUBRICS_JSON: 'rubrics_json',
  INPUT: 'input',
  OUTPUT: 'output',
  FILE_CHANGES: 'file_changes',
  TOOL_CALLS: 'tool_calls',
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
 * At least one of these should be present in a custom grader template.
 */
export const REQUIRED_TEMPLATE_VARIABLES = new Set<string>([
  TEMPLATE_VARIABLES.OUTPUT,
  TEMPLATE_VARIABLES.EXPECTED_OUTPUT,
]);
