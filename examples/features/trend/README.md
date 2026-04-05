# Trend Analysis Example

This example demonstrates `agentv trend` on three historical runs for the same dataset and target.

Scenario:

- Dataset: `code-review`
- Target: `claude-sonnet`
- Test IDs tracked across runs: `summary-accuracy`, `tool-selection`
- Outcome: scores degrade steadily from `0.92` to `0.86` to `0.80`

## Files

Tracked sample runs live in:

```text
sample-runs/
  2026-03-01T10-00-00-000Z/index.jsonl
  2026-03-08T10-00-00-000Z/index.jsonl
  2026-03-15T10-00-00-000Z/index.jsonl
```

These are canonical run directories with `index.jsonl`, so you can point `agentv trend` at them directly.

## End-User Flow

From this directory, run:

```bash
bun ../../../apps/cli/src/cli.ts trend \
  sample-runs/2026-03-01T10-00-00-000Z \
  sample-runs/2026-03-08T10-00-00-000Z \
  sample-runs/2026-03-15T10-00-00-000Z \
  --dataset code-review \
  --target claude-sonnet
```

Expected output:

```text
Trend Analysis

Runs: 3 | Range: 2026-03-01T10:00:00.000Z → 2026-03-15T10:00:00.000Z
Filters: dataset=code-review target=claude-sonnet mode=matched-tests
Matched Tests: 2 | Verdict: degrading

  Run                         Tests  Mean Score
  ────────────────────────  ───────  ──────────
  2026-03-01T10:00:00.000Z        2       0.920
  2026-03-08T10:00:00.000Z        2       0.860
  2026-03-15T10:00:00.000Z        2       0.800

Summary: slope=-0.060 intercept=0.920 r²=1.000
Regression Gate: threshold=0.010 fail_on_degrading=false triggered=false
```

Interpretation:

- The command uses the matched intersection of test IDs across all runs.
- Mean score declines each run, so the slope is negative.
- The verdict is `degrading`.

## CI Gate Example

To turn the same analysis into a failure signal:

```bash
bun ../../../apps/cli/src/cli.ts trend \
  sample-runs/2026-03-01T10-00-00-000Z \
  sample-runs/2026-03-08T10-00-00-000Z \
  sample-runs/2026-03-15T10-00-00-000Z \
  --dataset code-review \
  --target claude-sonnet \
  --fail-on-degrading \
  --slope-threshold 0.01
```

This exits with code `1` because the degrading slope magnitude exceeds `0.01`.

## `--last` Workflow

If you want to test the exact runtime layout used by `agentv eval`, copy the sample runs into `.agentv/results/runs/` first:

```bash
mkdir -p .agentv/results/runs
cp -R sample-runs/* .agentv/results/runs/
```

Then run:

```bash
bun ../../../apps/cli/src/cli.ts trend --last 3 --dataset code-review --target claude-sonnet
```
