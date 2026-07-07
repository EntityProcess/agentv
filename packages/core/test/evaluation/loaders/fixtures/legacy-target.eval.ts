export default {
  name: 'legacy-target',
  target: 'mock-target',
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'legacy-target',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};
