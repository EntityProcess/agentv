# Environment Variable Interpolation

Demonstrates `{{ env.VAR }}` syntax for portable eval configs.

## Usage

```bash
export EVAL_ASSERTION="Responds with a friendly greeting"
export CUSTOM_SYSTEM_PROMPT="You are a helpful assistant who always greets warmly."
agentv eval examples/features/env-interpolation/evals/suite.yaml
```

Or create a `.env` file — AgentV loads `.env` files automatically from the directory hierarchy.

## Features

- **Full-value**: `assert: ["{{ env.EVAL_ASSERTION }}"]` — entire assertion from env var
- **Partial/inline**: `"must be {{ env.EXPECTED }} and clear"` — env var within a string
- **Missing vars**: resolve to empty string (downstream validation catches required blanks)
- **All fields**: works in any string field — assertions, input, workspace paths, etc.
