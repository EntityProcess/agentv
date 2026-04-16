import type { EvalConfig } from '../../../../src/evaluation/evaluate.js';

export const evalConfig: EvalConfig = {
  tests: [
    {
      id: 'eval-config-named',
      input: 'Say hello',
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
};
