import type { EvalConfig } from '../../../../src/evaluation/evaluate.js';

export const config: EvalConfig = {
  tests: [
    {
      id: 'named-config',
      input: 'Say hello',
      assertions: [{ type: 'contains', value: 'hello' }],
    },
  ],
  target: { provider: 'mock_agent' },
};
