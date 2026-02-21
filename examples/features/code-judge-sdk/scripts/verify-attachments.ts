#!/usr/bin/env bun
/**
 * Code Judge SDK Demo
 *
 * Uses the declarative defineCodeJudge helper to verify attachments
 * are referenced in the candidate answer.
 */
import { defineCodeJudge } from '@agentv/eval';

function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export default defineCodeJudge(
  ({ expectedOutput, answer, guidelineFiles, inputFiles }) => {
    const hits: string[] = [];
    const misses: string[] = [];

    // Check if candidate matches expected message
    const expectedMessage = expectedOutput[0];
    const expectedContent =
      expectedMessage && typeof expectedMessage.content === 'string'
        ? expectedMessage.content
        : undefined;

    if (expectedContent && answer.trim() === expectedContent.trim()) {
      hits.push('Candidate answer matches expected message');
    } else {
      misses.push('Candidate answer does not match expected message');
    }

    // Check if attachments are mentioned
    const attachmentNames = [...guidelineFiles, ...inputFiles].map(fileName);
    for (const name of attachmentNames) {
      if (answer.includes(name)) {
        hits.push(`Mentions attachment: ${name}`);
      } else {
        misses.push(`Missing attachment: ${name}`);
      }
    }

    const score =
      hits.length + misses.length === 0 ? 0 : hits.length / (hits.length + misses.length);

    return {
      score,
      hits,
      misses,
      reasoning: `Checked ${hits.length + misses.length} conditions using defineCodeJudge`,
    };
  },
);
