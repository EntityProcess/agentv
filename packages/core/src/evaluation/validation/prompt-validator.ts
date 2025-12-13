import { readFile } from 'node:fs/promises';

import { TEMPLATE_VARIABLES, VALID_TEMPLATE_VARIABLES } from '../template-variables.js';

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

  // Check if template contains required variables for evaluation
  const hasCandidateAnswer = foundVariables.has(TEMPLATE_VARIABLES.CANDIDATE_ANSWER);
  const hasExpectedMessages = foundVariables.has(TEMPLATE_VARIABLES.EXPECTED_MESSAGES);
  const hasRequiredFields = hasCandidateAnswer || hasExpectedMessages;

  // ERROR: Missing required fields - throw error to skip this evaluator/eval case
  if (!hasRequiredFields) {
    throw new Error(
      `Missing required fields. Must include at least one of:\n  - {{ ${TEMPLATE_VARIABLES.CANDIDATE_ANSWER} }}\n  - {{ ${TEMPLATE_VARIABLES.EXPECTED_MESSAGES} }}`,
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
