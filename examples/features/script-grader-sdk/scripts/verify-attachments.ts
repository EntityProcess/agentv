#!/usr/bin/env bun
/**
 * script grader SDK Demo
 *
 * Uses the declarative defineScriptGrader helper to verify attachments
 * are referenced in the candidate output.
 */
import { defineScriptGrader } from '@agentv/sdk';

function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export default defineScriptGrader(({ expectedOutput, output, inputFiles }) => {
  const outputText = output ?? '';
  const checks: Array<{ text: string; pass: boolean; reason: string }> = [];

  // Check if candidate matches expected message
  const expectedMessage = expectedOutput[0];
  const expectedContent =
    expectedMessage && typeof expectedMessage.content === 'string'
      ? expectedMessage.content
      : undefined;

  if (expectedContent && outputText.trim() === expectedContent.trim()) {
    checks.push({
      text: 'Candidate output matches expected message',
      pass: true,
      reason: 'Candidate output exactly matched the expected message.',
    });
  } else {
    checks.push({
      text: 'Candidate output matches expected message',
      pass: false,
      reason: 'Candidate output did not exactly match the expected message.',
    });
  }

  // Check if attachments are mentioned
  const attachmentNames = inputFiles.map(fileName);
  for (const name of attachmentNames) {
    if (outputText.includes(name)) {
      checks.push({
        text: `Mentions attachment: ${name}`,
        pass: true,
        reason: `Candidate output mentions ${name}.`,
      });
    } else {
      checks.push({
        text: `Mentions attachment: ${name}`,
        pass: false,
        reason: `Candidate output does not mention ${name}.`,
      });
    }
  }

  const passed = checks.filter((check) => check.pass).length;
  return {
    pass: checks.length > 0 && passed === checks.length,
    score: checks.length > 0 ? passed / checks.length : 0,
    reason: `${passed}/${checks.length} attachment checks passed.`,
    checks,
  };
});
