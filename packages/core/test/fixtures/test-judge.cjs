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
    hits: [
      hasExpected ? 'expected_output present' : null,
      hasCandidate ? 'candidate_answer present' : null,
      candidateDecisionOk ? 'candidate_answer parses' : null,
    ].filter(Boolean),
    misses: [
      hasExpected ? null : 'expected_output missing',
      hasCandidate ? null : 'candidate_answer missing',
      candidateDecisionOk ? null : 'candidate_answer invalid',
    ].filter(Boolean),
  }),
);
