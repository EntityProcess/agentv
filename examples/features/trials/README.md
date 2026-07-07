# Repeat Runs

This example keeps the runnable contract in one eval file. Top-level `target`
selects the system under test and `evaluate_options.repeat` configures repeated
samples.

## Files

- `evals/suite.yaml` defines the task cases and inline runtime config.

## Run

```bash
bun agentv eval examples/features/trials/evals/suite.yaml
```

Edit `evaluate_options.repeat` to change how many samples AgentV records for
each case:

```yaml
evaluate_options:
  repeat: 2
  budget_usd: 1.00
```
