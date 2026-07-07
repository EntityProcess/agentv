const EVAL_SUITE_SYMBOL = Symbol.for('agentv/eval-suite');
const TO_EVAL_YAML_OBJECT_SYMBOL = Symbol.for('agentv/to-eval-yaml-object');

const suite = {
  name: 'sdk-define-eval-suite',
  description: 'YAML-aligned TypeScript suite authored with agentv',
  tags: ['sdk', 'typescript', 'yaml'],
  providers: [
    {
      id: 'mock',
      label: 'sdk-provider',
      config: { response: 'hello there' },
    },
    {
      id: 'openai:gpt-5-mini',
      label: 'grader-provider',
      config: { api_key: '{{ env.OPENAI_API_KEY }}' },
    },
  ],
  defaults: {
    provider: 'sdk-provider',
    grader: 'grader-provider',
  },
  defaultTest: {
    options: {
      provider: 'grader-provider',
    },
  },
  budgetUsd: 2,
  threshold: 0.75,
  prompts: ['{{ input }}'],
  workspace: {
    hooks: {
      beforeAll: {
        command: ['echo', 'suite-setup'],
      },
    },
  },
  tests: [
    {
      id: 'sdk-define-eval',
      vars: { input: 'Say hello' },
      expectedOutput: 'hello there',
      options: {
        provider: 'test-grader',
      },
      assert: [
        { type: 'contains', value: 'hello' },
        { type: 'llm-rubric', value: 'Greets the user' },
        { type: 'llm-rubric', value: 'Uses concise language', provider: 'assertion-grader' },
      ],
      workspace: {
        hooks: {
          beforeEach: {
            command: ['echo', 'case-setup'],
            timeoutMs: 1_000,
          },
        },
      },
    },
    {
      id: 'sdk-default-test-provider',
      vars: { input: 'Say hello again' },
      assert: [{ type: 'llm-rubric', value: 'Greets the user' }],
    },
  ],
};

export default Object.defineProperties(suite, {
  [EVAL_SUITE_SYMBOL]: {
    value: true,
    enumerable: false,
  },
  [TO_EVAL_YAML_OBJECT_SYMBOL]: {
    value: () => ({
      name: suite.name,
      description: suite.description,
      tags: suite.tags,
      providers: suite.providers,
      defaults: suite.defaults,
      default_test: {
        options: {
          provider: suite.defaultTest.options.provider,
        },
      },
      evaluate_options: {
        budget_usd: suite.budgetUsd,
      },
      threshold: suite.threshold,
      prompts: suite.prompts,
      workspace: {
        hooks: {
          before_all: {
            command: ['echo', 'suite-setup'],
          },
        },
      },
      tests: [
        {
          id: 'sdk-define-eval',
          vars: { input: 'Say hello' },
          expected_output: 'hello there',
          options: {
            provider: 'test-grader',
          },
          assert: [
            { type: 'contains', value: 'hello' },
            { type: 'llm-rubric', value: 'Greets the user' },
            { type: 'llm-rubric', value: 'Uses concise language', provider: 'assertion-grader' },
          ],
          workspace: {
            hooks: {
              before_each: {
                command: ['echo', 'case-setup'],
                timeout_ms: 1_000,
              },
            },
          },
        },
        {
          id: 'sdk-default-test-provider',
          vars: { input: 'Say hello again' },
          assert: [{ type: 'llm-rubric', value: 'Greets the user' }],
        },
      ],
    }),
    enumerable: false,
  },
});
