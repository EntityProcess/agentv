import type { EvalConfig } from '../../../../src/evaluation/evaluate.js';

export const evalConfig: EvalConfig = {
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'eval-config-named',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
};
