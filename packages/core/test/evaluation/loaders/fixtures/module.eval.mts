const config = {
  name: 'module-mts-config',
  target: 'mock-target',
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
