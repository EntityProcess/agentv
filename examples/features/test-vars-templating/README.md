# Per-Test Vars Templating

Demonstrates `tests[].vars` with `{{name}}` placeholders in eval files.

## Usage

```bash
agentv eval examples/features/test-vars-templating/evals/dataset.eval.yaml
```

## Features

- **Per-test data**: each test defines its own `vars` object
- **Template substitution**: `{{question}}` and dotted paths like `{{expected.answer}}`
- **Suite-level templates**: shared `input` can reference per-test vars too
- **Separate from env interpolation**: `{{question}}` uses test data, `${{ VAR }}` uses environment variables
