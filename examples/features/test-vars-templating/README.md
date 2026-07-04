# Prompt and Vars Templating

Demonstrates prompt templates rendered from `default_test.vars` and
`tests[].vars`, including a chat prompt file. The companion direct-input suite
shows the AgentV shorthand forms for suites that do not need top-level prompts.

## Usage

```bash
agentv eval examples/features/test-vars-templating/evals/suite.yaml
agentv eval examples/features/test-vars-templating/evals/direct-input.eval.yaml
```

## Features

- **Prompt matrix data**: top-level `prompts` render with shared `default_test.vars` plus per-test `vars`
- **Chat prompt files**: prompt files can contain role/content message arrays with `{{ name }}` placeholders
- **Per-test overrides**: `tests[].vars` overrides default vars by key
- **Template substitution**: `{{ question }}`, `{{ vars.question }}`, and dotted paths like `{{ vars.expected.answer }}`
- **Direct input convenience**: direct suites can use string `input` or role/content message arrays without top-level prompts
- **Separate from env interpolation**: `{{ vars.question }}` uses test data, `{{ env.VAR }}` uses environment variables
