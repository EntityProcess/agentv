import { defineConfig } from '@agentv/core';

export default defineConfig({
  execution: {
    workers: 3,
    maxRetries: 2,
    agentTimeoutMs: 60_000,
  },
  output: {
    format: 'jsonl',
    dir: './results',
  },
  limits: {
    maxCostUsd: 5.0,
  },
});
