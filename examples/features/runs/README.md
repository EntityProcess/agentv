# Repeat Runs

This example keeps the eval file focused on the task and puts repeat/run-count
behavior in committed experiment files.

## Files

- `evals/dataset.eval.yaml` defines the two task cases.
- `experiments/default.yaml` runs the cases with `pass_at_k`.
- `experiments/mean.yaml` aggregates repeated scores with `mean`.
- `experiments/confidence-interval.yaml` aggregates repeated scores with a 95%
  confidence interval lower bound.

## Run

```bash
bun agentv eval examples/features/runs/evals/dataset.eval.yaml \
  --experiment examples/features/runs/experiments/default.yaml
```

Swap the experiment path to try the other strategies.

## Migration from old `execution.trials`

The repeat block now lives on the experiment, not in `eval.yaml`:

```yaml
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
run all configured runs instead of stopping after the first pass.
