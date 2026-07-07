export default {
  name: 'legacy-targets',
  targets: ['mock-target'],
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'legacy-targets',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};
