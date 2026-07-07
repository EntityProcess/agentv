export const evalConfig = {
  prompts: ['{{ input }}'],
  providers: ['mock-provider'],
  tests: [
    {
      id: 'eval-config-named',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};
