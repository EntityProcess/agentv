# Autoresearch Example: Incident Severity Classifier

Demonstrates the autoresearch optimization loop with a practical scenario.

## Files

- `classifier-prompt.md` — The artifact to optimize (a severity classification prompt)
- `EVAL.yaml` — 7 test cases with mixed assertion types (deterministic + rubric)

## Running

This example works like any other eval:

```bash
agentv eval EVAL.yaml --experiment autoresearch-classifier --target azure
```

To run autoresearch, use the `agentv-bench` skill:

```
"Run autoresearch on examples/features/autoresearch/EVAL.yaml"
```

## Note

Autoresearch is a **workflow pattern** — it works with any eval file, not just this one. This example exists as a ready-to-run demo and documentation reference.
