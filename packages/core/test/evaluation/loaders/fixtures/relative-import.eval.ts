import { relativePrompt } from './relative-prompt.ts';

const config = {
  name: 'relative-import-ts-config',
  target: 'mock-target',
  tags: { experiment: 'ts-config', group: 'loader' },
  prompts: [relativePrompt],
  budgetUsd: 1,
  repeat: {
    count: 2,
    strategy: 'pass_any',
  },
  tests: [
    {
      id: 'relative-import',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};

export default config;
