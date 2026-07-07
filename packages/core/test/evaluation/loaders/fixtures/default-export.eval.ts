const config = {
  name: 'default-export-suite',
  tags: ['sdk', 'typescript'],
  prompts: ['{{ input }}'],
  providers: [
    {
      id: 'mock',
      label: 'inline-provider',
      config: { response: 'hello there' },
    },
  ],
  tests: [
    {
      id: 'greeting',
      vars: { input: 'Say hello' },
      assert: [{ type: 'contains', value: 'hello' }],
    },
  ],
  budgetUsd: 1.5,
  threshold: 0.9,
};

export default config;
