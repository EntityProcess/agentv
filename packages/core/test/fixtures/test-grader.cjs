#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasExpected = Array.isArray(input.expected_output);
// `output` is the final answer/scored result. Keep a tiny fallback so this
// fixture can still explain failures if an old message-array payload leaks.
const candidateText =
  typeof input.output === 'string'
    ? input.output
    : Array.isArray(input.output)
      ? input.output
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
          .join('')
      : '';
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
      { text: 'output present', passed: hasCandidate },
      { text: 'output parses', passed: candidateDecisionOk },
    ].filter((a) => a.passed !== undefined),
  }),
);
