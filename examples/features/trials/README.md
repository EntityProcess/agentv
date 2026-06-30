# Repeat Runs

This example keeps the runnable contract in one eval file. Top-level `target`
selects the system under test and `policy.repeat` configures repeat behavior.

## Files

- `evals/dataset.eval.yaml` defines the task cases and inline runtime config.

## Run

```bash
bun agentv eval examples/features/trials/evals/dataset.eval.yaml
```

Edit `policy.repeat.strategy` to try `mean` or `confidence_interval`.

## Migration from old `execution.trials`

The repeat block now lives under top-level `policy:` in `eval.yaml`:

```yaml
policy:
  repeat:
    count: 2
    strategy: pass_at_k
    cost_limit_usd: 1.00
```

Field mapping:

- `execution.trials.count` -> `policy.repeat.count`
- `execution.trials.strategy` -> `policy.repeat.strategy`
- `execution.trials.cost_limit_usd` -> `policy.repeat.cost_limit_usd`

Use top-level policy `early_exit: false` only when you want `pass_at_k` to
run all attempts instead of stopping after the first pass.
