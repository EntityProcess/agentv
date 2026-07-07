const config = {
  name: 'module-mts-config',
  providers: ['mock-provider'],
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'module-mts-config',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
};

export default config;
