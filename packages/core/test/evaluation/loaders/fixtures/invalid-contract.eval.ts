export default {
  prompts: ['{{ input }}'],
  providers: ['openai:gpt-5'],
  tests: [{ id: 'invalid', vars: { input: 'Say hello' } }],
};
