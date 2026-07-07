export default {
  name: 'legacy-graders',
  providers: ['mock-provider'],
  graders: [{ id: 'mock', label: 'grader-provider' }],
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'legacy-graders',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};
