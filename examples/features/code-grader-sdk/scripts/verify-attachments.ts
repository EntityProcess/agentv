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
  const hits: string[] = [];
  const misses: string[] = [];

  // Check if candidate matches expected message
  const expectedMessage = expectedOutput[0];
  const expectedContent =
    expectedMessage && typeof expectedMessage.content === 'string'
      ? expectedMessage.content
      : undefined;

  if (expectedContent && outputText.trim() === expectedContent.trim()) {
    hits.push('Candidate output matches expected message');
  } else {
    misses.push('Candidate output does not match expected message');
  }

  // Check if attachments are mentioned
  const attachmentNames = [...guidelineFiles, ...inputFiles].map(fileName);
  for (const name of attachmentNames) {
    if (outputText.includes(name)) {
      hits.push(`Mentions attachment: ${name}`);
    } else {
      misses.push(`Missing attachment: ${name}`);
    }
  }

  const score = hits.length + misses.length === 0 ? 0 : hits.length / (hits.length + misses.length);

  return {
    score,
    hits,
    misses,
    reasoning: `Checked ${hits.length + misses.length} conditions using defineCodeGrader`,
  };
});
