# Provider-Owned Batching

This example shows the replacement pattern for throughput-oriented CLI tools:
AgentV invokes the provider once per eval case, and the provider adapter owns
any batching behind that normal provider boundary.

The eval and provider catalog do not use `batch_requests`, `provider_batching`,
or runner-owned grouping. `evals/suite.yaml` selects a normal provider label:

```yaml
providers:
  - provider-owned-batch-cli
evaluate_options:
  max_concurrency: 3
```

`providers.yaml` then points at a single-case CLI adapter:

```yaml
- id: cli
  label: provider-owned-batch-cli
  command: bun run ./scripts/provider-owned-batch-adapter.ts {PROMPT_FILE} {OUTPUT_FILE} {EVAL_ID}
  cwd: ..
- id: mock
  label: grader
```

The `grader` entry satisfies this repository's default grader label; the suite's
checks are deterministic `contains` assertions.

## How It Works

1. AgentV starts ordinary per-case CLI provider invocations.
2. Each adapter process appends its request to a provider-owned queue directory.
3. The adapter uses a timeout trigger to flush all queued requests in one
   synthetic batch.
4. The batch writes one response file per queued request id.
5. Each waiting adapter process returns its own response to AgentV, preserving
   per-case response, error, and trace identity.

The timeout flush is intentionally inside the adapter. A real provider could
replace it with EOF on a long-lived process, an explicit flush command, or a
future provider lifecycle drain hook without adding runner-level batch config.

## Run

From the repository root:

```bash
bun apps/cli/src/cli.ts validate examples/features/provider-owned-batching/evals/suite.yaml
bun apps/cli/src/cli.ts eval examples/features/provider-owned-batching/evals/suite.yaml \
  --providers examples/features/provider-owned-batching/providers.yaml
```

Focused smoke coverage for the provider-owned protocol:

```bash
bun examples/features/provider-owned-batching/scripts/smoke-provider-owned-batching.ts
```

The smoke test starts three adapter invocations concurrently and verifies that
they are flushed as one provider-owned batch while still receiving three
correlated responses.
