# Repeat Runs

This example keeps the runnable contract in one eval file. Top-level `target`
selects the system under test and top-level `runs` configures repeated attempts.

## Files

- `evals/dataset.eval.yaml` defines the task cases and inline runtime config.

## Run

```bash
bun agentv eval examples/features/trials/evals/dataset.eval.yaml
```

Edit `runs` to change how many attempts AgentV makes for each case:

```yaml
runs: 2
budget_usd: 1.00
```
