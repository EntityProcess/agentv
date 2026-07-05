#!/usr/bin/env node
/**
 * Test fixture: Code grader that emits a `details` object for passthrough testing.
 */
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasExpected = Array.isArray(input.expected_output);
// `output` is the final answer/scored result. Keep a tiny fallback so this
// fixture can still explain failures if an old message-array payload leaks.
const candidateText =
  typeof input.output === 'string'
    ? input.output
    : Array.isArray(input.output)
      ? input.output.map((m) => String(m.content ?? '')).join('')
      : '';
const hasCandidate = candidateText.length > 0;
const pass = hasExpected && hasCandidate;

// Emit details with structured metrics
console.log(
  JSON.stringify({
    pass,
    score: pass ? 0.75 : 0,
    reason: pass
      ? 'Expected output and candidate output were present'
      : 'Missing required payload data',
    checks: [
      { text: 'expected_output present', pass: hasExpected, reason: 'expected_output was present' },
      { text: 'output present', pass: hasCandidate, reason: 'output was present' },
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
