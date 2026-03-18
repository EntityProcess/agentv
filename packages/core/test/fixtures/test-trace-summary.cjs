#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const summary = input.trace;
const hasEventCount = summary && typeof summary.event_count === 'number';
const hasTokenUsage = input.token_usage && typeof input.token_usage.input === 'number';
const hasCostUsd = typeof input.cost_usd === 'number';
const score = hasEventCount && hasTokenUsage && hasCostUsd ? 1 : 0;

console.log(
  JSON.stringify({
    score,
    assertions: [
      { text: 'eventCount present', passed: !!hasEventCount },
      { text: 'tokenUsage present', passed: !!hasTokenUsage },
      { text: 'costUsd present', passed: !!hasCostUsd },
    ],
  }),
);
