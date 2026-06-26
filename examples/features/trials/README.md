# Repeat Runs

This example keeps the runnable contract in one eval file. The inline
`experiment:` block configures target selection and repeat/run-count behavior.

## Files

- `evals/dataset.eval.yaml` defines the task cases and inline runtime config.

## Run

```bash
bun agentv eval examples/features/trials/evals/dataset.eval.yaml
```

Edit `experiment.repeat.strategy` to try `mean` or `confidence_interval`.

## Migration from old `execution.trials`

The repeat block now lives under `experiment:` in `eval.yaml`:

```yaml
experiment:
  repeat:
    count: 2
    strategy: pass_at_k
    cost_limit_usd: 1.00
```

Field mapping:

- `execution.trials.count` -> `experiment.repeat.count`
- `execution.trials.strategy` -> `experiment.repeat.strategy`
- `execution.trials.cost_limit_usd` -> `experiment.repeat.cost_limit_usd`
- `execution.trials.costLimitUsd` -> accepted only as `experiment.repeat.costLimitUsd`
  for prerelease compatibility

Use top-level experiment `early_exit: false` only when you want `pass_at_k` to
run all attempts instead of stopping after the first pass.
