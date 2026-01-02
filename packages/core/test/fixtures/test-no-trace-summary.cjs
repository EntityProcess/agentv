#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasSummary = input.trace_summary !== null && input.trace_summary !== undefined;

console.log(
  JSON.stringify({
    score: hasSummary ? 0 : 1,
    hits: hasSummary ? [] : ['Correctly handled missing summary'],
    misses: hasSummary ? ['Expected no summary'] : [],
    reasoning: 'Checked for missing trace_summary',
  }),
);
