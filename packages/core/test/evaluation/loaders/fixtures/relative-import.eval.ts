import { relativePrompt } from './relative-prompt.ts';

const config = {
  name: 'relative-import-ts-config',
  providers: ['mock-provider'],
  tags: { experiment: 'ts-config', group: 'loader' },
  prompts: [relativePrompt],
  budgetUsd: 1,
  repeat: 2,
  tests: [
    {
      id: 'relative-import',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};

export default config;
