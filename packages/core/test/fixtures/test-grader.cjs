#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasExpected = Array.isArray(input.expected_output);
// Extract candidate text from the output message array
const outputMessages = Array.isArray(input.output) ? input.output : [];
const candidateText = outputMessages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('');
const hasCandidate = candidateText.length > 0;
let candidateDecisionOk = false;

try {
  const obj = JSON.parse(candidateText);
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
