#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasExpected = Array.isArray(input.expected_output);
const hasCandidate = typeof input.answer === 'string';
let candidateDecisionOk = false;

try {
  const obj = JSON.parse(input.answer);
  candidateDecisionOk = obj && obj.decision === 'ACCEPT';
} catch {}

const ok = hasExpected && hasCandidate && candidateDecisionOk;

console.log(
  JSON.stringify({
    score: ok ? 1 : 0,
    assertions: [
      { text: 'expected_output present', passed: hasExpected },
      { text: 'answer present', passed: hasCandidate },
      { text: 'answer parses', passed: candidateDecisionOk },
    ].filter((a) => a.passed !== undefined),
  }),
);
