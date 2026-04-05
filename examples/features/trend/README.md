# Trend Analysis Example

This example demonstrates `agentv trend` on three historical runs for the same suite and target.

Scenario:

- Suite: `code-review`
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

These are canonical run directories with `index.jsonl`.

## End-User Flow

Most real users will run `trend` against their latest eval history with `--last`.

To reproduce that flow from this example directory, first copy the sample runs into the normal runtime layout:

```bash
mkdir -p .agentv/results/runs
cp -R sample-runs/* .agentv/results/runs/
```

Then run:

```bash
bun ../../../apps/cli/src/cli.ts trend --last 3 --suite code-review --target claude-sonnet
```

Expected output:

```text
Trend Analysis

Runs: 3 | Range: 2026-03-01T10:00:00.000Z → 2026-03-15T10:00:00.000Z
Filters: suite=code-review target=claude-sonnet mode=matched-tests
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

- The command auto-discovers the most recent three runs.
- It filters to `suite=code-review` and `target=claude-sonnet`.
- It intersects matched test IDs across runs and detects a steady downward score trend.

## Explicit Inputs

If you want to see the same analysis without copying files into `.agentv/results/runs/`, point `trend` at the sample runs directly:

```bash
bun ../../../apps/cli/src/cli.ts trend \
  sample-runs/2026-03-01T10-00-00-000Z \
  sample-runs/2026-03-08T10-00-00-000Z \
  sample-runs/2026-03-15T10-00-00-000Z \
  --suite code-review \
  --target claude-sonnet
```

## CI Gate Example

To turn the same analysis into a failure signal:

```bash
bun ../../../apps/cli/src/cli.ts trend \
  sample-runs/2026-03-01T10-00-00-000Z \
  sample-runs/2026-03-08T10-00-00-000Z \
  sample-runs/2026-03-15T10-00-00-000Z \
  --suite code-review \
  --target claude-sonnet \
  --fail-on-degrading \
  --slope-threshold 0.01
```

This exits with code `1` because the degrading slope magnitude exceeds `0.01`.
