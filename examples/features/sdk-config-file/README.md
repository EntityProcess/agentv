# SDK Example: Config File

Demonstrates using `defineConfig()` from `@agentv/core` for typed project-level configuration.

## What It Does

1. Creates an `agentv.config.ts` with `defineConfig()`
2. Configures execution defaults (workers, retries)
3. Sets output format and cost limits

## How to Run

```bash
# From repository root
cd examples/features/sdk-config-file
bun install

# Run the evaluation (picks up agentv.config.ts automatically)
agentv eval evals/dataset.eval.yaml
```

## Key Patterns

- **`defineConfig()`** — typed configuration with IDE autocomplete
- **Auto-discovery** — `agentv.config.ts` found automatically at project root
- **Zod validation** — config validated at load time with clear errors
