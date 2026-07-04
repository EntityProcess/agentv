import type { EvalConfig } from '../../../../src/evaluation/evaluate.js';

export const config: EvalConfig = {
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'named-config',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
};
