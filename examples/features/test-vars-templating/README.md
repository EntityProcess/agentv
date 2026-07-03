# Per-Test Vars Templating

Demonstrates `tests[].vars` with `{{ vars.name }}` placeholders in eval files.

## Usage

```bash
agentv eval examples/features/test-vars-templating/evals/suite.yaml
```

## Features

- **Per-test data**: each test defines its own `vars` object
- **Template substitution**: `{{ vars.question }}` and dotted paths like `{{ vars.expected.answer }}`
- **Suite-level templates**: shared `input` can reference per-test vars too
- **Separate from env interpolation**: `{{ vars.question }}` uses test data, `{{ env.VAR }}` uses environment variables
