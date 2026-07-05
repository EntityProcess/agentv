#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const summary = input.trace;
const hasEventCount = summary && typeof summary.event_count === 'number';
const hasTokenUsage = input.token_usage && typeof input.token_usage.input === 'number';
const hasCostUsd = typeof input.cost_usd === 'number';
const score = hasEventCount && hasTokenUsage && hasCostUsd ? 1 : 0;
const pass = score === 1;

console.log(
  JSON.stringify({
    pass,
    score,
    reason: pass ? 'Trace summary fields are present' : 'Trace summary fields are missing',
    checks: [
      {
        text: 'eventCount present',
        pass: !!hasEventCount,
        reason: hasEventCount ? 'event_count is present' : 'event_count is missing',
      },
      {
        text: 'tokenUsage present',
        pass: !!hasTokenUsage,
        reason: hasTokenUsage ? 'token_usage is present' : 'token_usage is missing',
      },
      {
        text: 'costUsd present',
        pass: !!hasCostUsd,
        reason: hasCostUsd ? 'cost_usd is present' : 'cost_usd is missing',
      },
    ],
  }),
);
