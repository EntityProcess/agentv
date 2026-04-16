/**
 * Template variable constants for evaluator prompts.
 * These variables can be used in custom grader templates with {{ variable_name }} syntax.
 *
 * Primary variables:
 *   - {{ input }}           — input as plain text (single-turn) or role-prefixed conversation (multi-turn)
 *   - {{ output }}          — last assistant message as plain text
 *   - {{ expected_output }} — reference answer as plain text
 *   - {{ criteria }}        — evaluation criteria string
 *   - {{ file_changes }}    — file diff (if available)
 *   - {{ tool_calls }}     — formatted summary of tool calls from agent execution
 *
 * Deprecated aliases (emit a warning when used in custom templates):
 *   - {{ input_text }}           → use {{ input }}
 *   - {{ output_text }}          → use {{ output }}
 *   - {{ expected_output_text }} → use {{ expected_output }}
 */
export const TEMPLATE_VARIABLES = {
  EXPECTED_OUTPUT: 'expected_output',
  CRITERIA: 'criteria',
  INPUT: 'input',
  OUTPUT: 'output',
  FILE_CHANGES: 'file_changes',
  TOOL_CALLS: 'tool_calls',
  /** @deprecated Use INPUT instead — resolves to the same text value. */
  INPUT_TEXT: 'input_text',
  /** @deprecated Use OUTPUT instead — resolves to the same text value. */
  OUTPUT_TEXT: 'output_text',
  /** @deprecated Use EXPECTED_OUTPUT instead — resolves to the same text value. */
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
 * At least one of these should be present in a custom grader template.
 */
export const REQUIRED_TEMPLATE_VARIABLES = new Set<string>([
  TEMPLATE_VARIABLES.OUTPUT,
  TEMPLATE_VARIABLES.EXPECTED_OUTPUT,
]);

/**
 * Deprecated template variable names that still work but trigger a warning.
 * Maps deprecated name → replacement name.
 */
export const DEPRECATED_TEMPLATE_VARIABLES: ReadonlyMap<string, string> = new Map([
  [TEMPLATE_VARIABLES.INPUT_TEXT, TEMPLATE_VARIABLES.INPUT],
  [TEMPLATE_VARIABLES.OUTPUT_TEXT, TEMPLATE_VARIABLES.OUTPUT],
  [TEMPLATE_VARIABLES.EXPECTED_OUTPUT_TEXT, TEMPLATE_VARIABLES.EXPECTED_OUTPUT],
]);
