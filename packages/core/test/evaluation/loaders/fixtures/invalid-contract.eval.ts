export default {
  prompts: ['{{ input }}'],
  providers: [{ provider: 'mock' }],
  tests: [
    {
      id: 'invalid',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};
