# Trend Analysis Example

This example shows the canonical run-workspace layout used by `agentv trend`.

From this directory:

```bash
bun ../../../apps/cli/src/cli.ts trend --last 3 --dataset code-review --target claude-sonnet
```

The sample manifests in `.agentv/results/runs/` are synthetic and show a degrading score trend across three historical runs.

You can also point at the runs explicitly:

```bash
bun ../../../apps/cli/src/cli.ts trend \
  .agentv/results/runs/2026-03-01T10-00-00-000Z/ \
  .agentv/results/runs/2026-03-08T10-00-00-000Z/ \
  .agentv/results/runs/2026-03-15T10-00-00-000Z/ \
  --dataset code-review \
  --target claude-sonnet
```
