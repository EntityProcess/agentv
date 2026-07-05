import { readFileSync, writeFileSync } from 'node:fs';

const promptFile = process.argv[2];
const outputFile = process.argv[3];

if (!promptFile || !outputFile) {
  throw new Error('missing args');
}

const prompt = readFileSync(promptFile, 'utf8');
const passed = prompt.includes('spreadsheet: revenue,total') && prompt.includes('Q1,42');
const rubricIds = Array.from(prompt.matchAll(/- \[(rubric-\d+)\]/g), (match) => match[1]);
const checkIds = rubricIds.length > 0 ? rubricIds : ['rubric-1'];

writeFileSync(
  outputFile,
  JSON.stringify({
    text: JSON.stringify({
      checks: checkIds.map((id) => ({
        id,
        satisfied: passed,
        reasoning: passed
          ? 'found transformed spreadsheet text in prompt'
          : 'transformed spreadsheet text missing from prompt',
      })),
      overall_reasoning: passed
        ? 'The transformed spreadsheet rows reached the rubric prompt.'
        : 'The transformed spreadsheet rows did not reach the rubric prompt.',
    }),
  }),
  'utf8',
);
