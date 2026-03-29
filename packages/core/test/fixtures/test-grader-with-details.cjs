#!/usr/bin/env node
/**
 * Test fixture: Code grader that emits a `details` object for passthrough testing.
 */
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasExpected = Array.isArray(input.expected_output);
// Extract candidate text from the output message array
const outputMessages = Array.isArray(input.output) ? input.output : [];
const candidateText = outputMessages.map((m) => String(m.content ?? '')).join('');
const hasCandidate = candidateText.length > 0;

// Emit details with structured metrics
console.log(
  JSON.stringify({
    score: hasExpected && hasCandidate ? 0.75 : 0,
    assertions: [
      ...(hasExpected ? [{ text: 'expected_output present', passed: true }] : []),
      ...(hasCandidate ? [] : [{ text: 'answer missing', passed: false }]),
    ],
    details: {
      metrics: {
        tp: 5,
        tn: 2,
        fp: 1,
        fn: 2,
      },
      alignment: [
        { expectedIdx: 0, parsedIdx: 1, similarity: 0.95 },
        { expectedIdx: 1, parsedIdx: 0, similarity: 0.88 },
      ],
      precision: 0.833,
      recall: 0.714,
      f1: 0.769,
    },
  }),
);
