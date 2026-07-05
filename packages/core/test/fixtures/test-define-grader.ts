#!/usr/bin/env bun
/**
 * Test fixture for the script-grader stdin/stdout contract.
 */
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  readonly output?: string | null;
  readonly criteria?: string;
};

const checks: { text: string; pass: boolean; reason: string }[] = [];

// `output` is the final answer/scored result. Transcript-aware graders should
// use messages/trace instead.
const candidateText = input.output ?? '';
const criteria = input.criteria ?? '';

// Simple check: does candidate mention the criteria keywords?
const outcomeWords = criteria.toLowerCase().split(/\s+/);
const candidateWords = candidateText.toLowerCase().split(/\s+/);

for (const word of outcomeWords) {
  if (word.length > 3 && candidateWords.includes(word)) {
    checks.push({ text: `Contains keyword: ${word}`, pass: true, reason: `Found keyword ${word}` });
  }
}

if (checks.length === 0) {
  checks.push({
    text: 'No matching keywords found',
    pass: false,
    reason: 'No criteria words matched',
  });
}

const pass = checks.some((check) => check.pass);
const score = pass ? 1.0 : 0.0;

console.log(
  JSON.stringify(
    {
      pass,
      score,
      reason: pass ? 'At least one criteria keyword matched' : 'No criteria keywords matched',
      checks,
    },
    null,
    2,
  ),
);
