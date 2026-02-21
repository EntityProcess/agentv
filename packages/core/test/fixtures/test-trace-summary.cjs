#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const summary = input.trace;
const hasEventCount = summary && typeof summary.event_count === 'number';
const hasTokenUsage = summary?.token_usage && typeof summary.token_usage.input === 'number';
const hasCostUsd = summary && typeof summary.cost_usd === 'number';
const score = hasEventCount && hasTokenUsage && hasCostUsd ? 1 : 0;

console.log(
  JSON.stringify({
    score,
    hits: [
      hasEventCount ? 'eventCount present' : null,
      hasTokenUsage ? 'tokenUsage present' : null,
      hasCostUsd ? 'costUsd present' : null,
    ].filter(Boolean),
    misses: [
      hasEventCount ? null : 'eventCount missing',
      hasTokenUsage ? null : 'tokenUsage missing',
      hasCostUsd ? null : 'costUsd missing',
    ].filter(Boolean),
    reasoning: 'Checked trace fields',
  }),
);
