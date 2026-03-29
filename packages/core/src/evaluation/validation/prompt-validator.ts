import { readFile } from 'node:fs/promises';

import {
  DEPRECATED_TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLES,
  VALID_TEMPLATE_VARIABLES,
} from '../template-variables.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

/**
 * Validate custom prompt template content from a file.
 * Reads the file and checks for valid template variables.
 * Throws an error if required template variables are missing.
 */
export async function validateCustomPromptContent(promptPath: string): Promise<void> {
  const content = await readFile(promptPath, 'utf8');
  validateTemplateVariables(content, promptPath);
}

/**
 * Validate template variables in a custom prompt template string.
 * Exported for testing purposes.
 * @throws Error if required template variables are missing
 */
export function validateTemplateVariables(content: string, source: string): void {
  // Extract all template variables from content
  const variablePattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const foundVariables = new Set<string>();
  const invalidVariables: string[] = [];

  let match: RegExpExecArray | null = variablePattern.exec(content);
  while (match !== null) {
    const varName = match[1];
    foundVariables.add(varName);
    if (!VALID_TEMPLATE_VARIABLES.has(varName)) {
      invalidVariables.push(varName);
    }
    match = variablePattern.exec(content);
  }

  // Check if template contains required variables for evaluation.
  // Accept both new names (output, expected_output) and deprecated aliases (output_text, expected_output_text).
  const hasCandidateAnswer =
    foundVariables.has(TEMPLATE_VARIABLES.OUTPUT) ||
    foundVariables.has(TEMPLATE_VARIABLES.OUTPUT_TEXT);
  const hasExpectedOutput = foundVariables.has(TEMPLATE_VARIABLES.EXPECTED_OUTPUT);
  const hasRequiredFields = hasCandidateAnswer || hasExpectedOutput;

  // ERROR: Missing required fields - throw error to skip this evaluator/eval case
  if (!hasRequiredFields) {
    throw new Error(
      `Missing required fields. Must include at least one of:\n  - {{ ${TEMPLATE_VARIABLES.OUTPUT} }}\n  - {{ ${TEMPLATE_VARIABLES.EXPECTED_OUTPUT} }}`,
    );
  }

  // WARNING: Deprecated variables - show warning but continue
  const deprecatedUsed: string[] = [];
  for (const [deprecated, replacement] of DEPRECATED_TEMPLATE_VARIABLES) {
    if (foundVariables.has(deprecated)) {
      deprecatedUsed.push(`{{ ${deprecated} }} → {{ ${replacement} }}`);
    }
  }
  if (deprecatedUsed.length > 0) {
    console.warn(
      `${ANSI_YELLOW}Warning: Template at ${source} uses deprecated variable names:\n  ${deprecatedUsed.join('\n  ')}\n  These still work but will be removed in a future version.${ANSI_RESET}`,
    );
  }

  // WARNING: Invalid variables - show warning but continue
  if (invalidVariables.length > 0) {
    const warningMessage = `${ANSI_YELLOW}Warning: Custom evaluator template at ${source}
  Contains invalid variables: ${invalidVariables.map((v) => `{{ ${v} }}`).join(', ')}
  Valid variables: ${Array.from(VALID_TEMPLATE_VARIABLES)
    .map((v) => `{{ ${v} }}`)
    .join(', ')}${ANSI_RESET}`;

    console.warn(warningMessage);
  }
}
