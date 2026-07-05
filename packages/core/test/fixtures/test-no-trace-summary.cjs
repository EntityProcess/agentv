#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hasSummary = input.trace !== null && input.trace !== undefined;
const pass = !hasSummary;

console.log(
  JSON.stringify({
    pass,
    score: pass ? 1 : 0,
    reason: pass ? 'Correctly handled missing summary' : 'Expected no summary',
    checks: [
      {
        text: pass ? 'Correctly handled missing summary' : 'Expected no summary',
        pass,
        reason: pass ? 'No trace summary was present' : 'Trace summary was present',
      },
    ],
  }),
);
