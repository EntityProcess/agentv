# Repeat Runs

This example keeps the runnable contract in one eval file. Top-level `target`
selects the system under test and `policy.runs` configures repeated attempts.

## Files

- `evals/dataset.eval.yaml` defines the task cases and inline runtime config.

## Run

```bash
bun agentv eval examples/features/trials/evals/dataset.eval.yaml
```

Edit `policy.runs` to change how many attempts AgentV makes for each case.

## Migration from old `execution.trials`

The run count now lives under top-level `policy:` in `eval.yaml`:

```yaml
policy:
  runs: 2
  budget_usd: 1.00
```

Field mapping:

- `execution.trials.count` -> `policy.runs`
- `execution.trials.cost_limit_usd` -> `policy.budget_usd`
