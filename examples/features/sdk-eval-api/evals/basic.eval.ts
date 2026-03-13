import { Contains, Eval } from '@agentv/core';

Eval('sdk-example/basic', {
  data: [
    {
      id: 'greeting',
      input: 'Say hello',
      expectedOutput: 'hello',
      criteria: 'Response should contain a greeting',
    },
    {
      id: 'math',
      input: 'What is 2+2?',
      expectedOutput: '4',
      criteria: 'Response should contain the correct answer',
    },
  ],
  target: { name: 'default', provider: 'mock', response: 'hello, the answer is 4' },
  assert: [
    Contains('hello'),
    ({ output, expectedOutput }) => ({
      name: 'has-expected',
      score: output.includes(expectedOutput ?? '') ? 1.0 : 0.0,
    }),
  ],
});
