# Environment Variable Interpolation

Demonstrates `${{ VAR }}` syntax for portable eval configs.

## Usage

```bash
export EVAL_CRITERIA="Responds with a friendly greeting"
export CUSTOM_SYSTEM_PROMPT="You are a helpful assistant who always greets warmly."
agentv eval examples/features/env-interpolation/evals/dataset.eval.yaml
```

Or create a `.env` file — AgentV loads `.env` files automatically from the directory hierarchy.

## Features

- **Full-value**: `criteria: "${{ EVAL_CRITERIA }}"` — entire field from env var
- **Partial/inline**: `"must be ${{ EXPECTED }} and clear"` — env var within a string
- **Missing vars**: resolve to empty string (downstream validation catches required blanks)
- **All fields**: works in any string field — criteria, input, workspace paths, etc.
