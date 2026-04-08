import { readFileSync, writeFileSync } from 'node:fs';

const promptFile = process.argv[2];
const outputFile = process.argv[3];

if (!promptFile || !outputFile) {
  throw new Error('missing args');
}

const prompt = readFileSync(promptFile, 'utf8');
const passed = prompt.includes('spreadsheet: revenue,total') && prompt.includes('Q1,42');

writeFileSync(
  outputFile,
  JSON.stringify({
    text: JSON.stringify({
      score: passed ? 1 : 0,
      assertions: [
        {
          text: 'preprocessed file content reached the llm grader',
          passed,
          evidence: passed
            ? 'found transformed spreadsheet text in prompt'
            : 'transformed spreadsheet text missing from prompt',
        },
      ],
    }),
  }),
  'utf8',
);
