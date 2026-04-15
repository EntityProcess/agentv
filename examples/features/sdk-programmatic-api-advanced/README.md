# SDK Programmatic API — Advanced

Demonstrates the advanced programmatic API features added in [#1115](https://github.com/anthropics/agentv/issues/1115):

- **`beforeAll`** — run setup commands before the suite starts
- **`budgetUsd`** — cap total LLM spend
- **`turns`** — multi-turn conversation evaluation
- **`aggregation`** — control how turn scores combine (`mean`, `min`, `max`)

## Run

```bash
bun run evaluate.ts
```

See also: [`sdk-programmatic-api`](../sdk-programmatic-api/) for the basic API.
