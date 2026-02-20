#!/usr/bin/env node
/**
 * Test fixture: Code judge that emits a `details` object for passthrough testing.
 */
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasExpected = Array.isArray(input.expected_output);
const hasCandidate = typeof input.candidate_answer === 'string';

// Emit details with structured metrics
console.log(
  JSON.stringify({
    score: hasExpected && hasCandidate ? 0.75 : 0,
    hits: hasExpected ? ['expected_output present'] : [],
    misses: hasCandidate ? [] : ['candidate_answer missing'],
    reasoning: 'Testing details passthrough',
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
