import type { EvalConfig } from '../../../../src/evaluation/evaluate.js';

const config: EvalConfig = {
  tests: [
    {
      id: 'greeting',
      input: 'Say hello',
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
};

export default config;
