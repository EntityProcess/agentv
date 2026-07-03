import type { EvalConfig } from '../../../../src/evaluation/evaluate.js';

export const config: EvalConfig = {
  tests: [
    {
      id: 'named-config',
      input: 'Say hello',
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
};
