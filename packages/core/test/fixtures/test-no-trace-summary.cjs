#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasSummary = input.trace !== null && input.trace !== undefined;

console.log(
  JSON.stringify({
    score: hasSummary ? 0 : 1,
    assertions: hasSummary
      ? [{ text: 'Expected no summary', passed: false }]
      : [{ text: 'Correctly handled missing summary', passed: true }],
  }),
);
