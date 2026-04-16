import type { EvalConfig } from '../../../../src/evaluation/evaluate.js';

const config: EvalConfig = {
  metadata: {
    name: 'default-export-suite',
    tags: ['sdk', 'typescript'],
  },
  tests: [
    {
      id: 'greeting',
      input: 'Say hello',
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  workers: 2,
  cache: false,
  budgetUsd: 1.5,
  threshold: 0.9,
  target: { name: 'inline-target', provider: 'mock', response: 'hello there' },
};

export default config;
