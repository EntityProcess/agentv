#!/usr/bin/env bun
/**
 * Code Judge SDK demo.
 *
 * Uses the optional TypeScript helper to parse the snake_case stdin payload
 * into camelCase objects.
 */
import { readCodeJudgePayload } from '@agentv/core';

function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

async function main(): Promise<void> {
  try {
    const payload = readCodeJudgePayload();

    const hits: string[] = [];
    const misses: string[] = [];

    const expectedMessage = payload.expectedMessages[0];
    const expectedContent =
      expectedMessage && typeof expectedMessage.content === 'string'
        ? expectedMessage.content
        : undefined;

    if (expectedContent && payload.candidateAnswer.trim() === expectedContent.trim()) {
      hits.push('Candidate answer matches expected message');
    } else {
      misses.push('Candidate answer does not match expected message');
    }

    const attachmentNames = [...payload.guidelineFiles, ...payload.inputFiles].map(fileName);
    for (const name of attachmentNames) {
      if (payload.candidateAnswer.includes(name)) {
        hits.push(`Mentions attachment: ${name}`);
      } else {
        misses.push(`Missing attachment: ${name}`);
      }
    }

    const score = hits.length + misses.length === 0 ? 0 : hits.length / (hits.length + misses.length);

    const result = {
      score,
      hits,
      misses,
      reasoning: `Checked ${hits.length + misses.length} conditions using TS helper payload`,
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        score: 0,
        hits: [],
        misses: [`Error: ${message}`],
        reasoning: 'Script execution failed',
      }),
    );
    process.exit(1);
  }
}

main();
