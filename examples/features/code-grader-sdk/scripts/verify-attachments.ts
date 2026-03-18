#!/usr/bin/env bun
/**
 * Code Grader SDK Demo
 *
 * Uses the declarative defineCodeGrader helper to verify attachments
 * are referenced in the candidate output.
 */
import { defineCodeGrader } from '@agentv/eval';

function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export default defineCodeGrader(({ expectedOutput, outputText, guidelineFiles, inputFiles }) => {
  const assertions: Array<{ text: string; passed: boolean }> = [];

  // Check if candidate matches expected message
  const expectedMessage = expectedOutput[0];
  const expectedContent =
    expectedMessage && typeof expectedMessage.content === 'string'
      ? expectedMessage.content
      : undefined;

  if (expectedContent && outputText.trim() === expectedContent.trim()) {
    assertions.push({ text: 'Candidate output matches expected message', passed: true });
  } else {
    assertions.push({ text: 'Candidate output does not match expected message', passed: false });
  }

  // Check if attachments are mentioned
  const attachmentNames = [...guidelineFiles, ...inputFiles].map(fileName);
  for (const name of attachmentNames) {
    if (outputText.includes(name)) {
      assertions.push({ text: `Mentions attachment: ${name}`, passed: true });
    } else {
      assertions.push({ text: `Missing attachment: ${name}`, passed: false });
    }
  }

  const passed = assertions.filter((a) => a.passed).length;
  const score = assertions.length === 0 ? 0 : passed / assertions.length;

  return {
    score,
    assertions,
  };
});
