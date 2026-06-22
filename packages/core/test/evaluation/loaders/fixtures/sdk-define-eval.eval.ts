const EVAL_SUITE_SYMBOL = Symbol.for('@agentv/sdk/eval-suite');
const TO_EVAL_YAML_OBJECT_SYMBOL = Symbol.for('@agentv/sdk/to-eval-yaml-object');

const suite = {
  name: 'sdk-define-eval-suite',
  description: 'YAML-aligned TypeScript suite authored with @agentv/sdk',
  tags: ['sdk', 'typescript', 'yaml'],
  execution: {
    targets: ['mock-target'],
    workers: 2,
    skipDefaults: true,
    budgetUsd: 2,
    threshold: 0.75,
  },
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
      input: 'Say hello',
      expectedOutput: 'hello there',
      assertions: [{ type: 'contains', value: 'hello' }],
      workspace: {
        hooks: {
          beforeEach: {
            command: ['echo', 'case-setup'],
            timeoutMs: 1_000,
          },
        },
      },
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
      execution: {
        targets: ['mock-target'],
        workers: 2,
        skip_defaults: true,
        budget_usd: 2,
        threshold: 0.75,
      },
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
          input: 'Say hello',
          expected_output: 'hello there',
          assertions: [{ type: 'contains', value: 'hello' }],
          workspace: {
            hooks: {
              before_each: {
                command: ['echo', 'case-setup'],
                timeout_ms: 1_000,
              },
            },
          },
        },
      ],
    }),
    enumerable: false,
  },
});
