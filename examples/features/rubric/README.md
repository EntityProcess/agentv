# Rubric Evaluator Example

Demonstrates rubric-based evaluation with weights, required flags, and auto-generation.

## What This Shows

- Inline rubrics as strings
- Rubric objects with weights
- Required vs optional criteria
- Auto-generating rubrics from expected_outcome
- Rubric file references

## Running

```bash
# From repository root
bun agentv eval examples/features/rubric/evals/dataset.yaml --target default
```

## Key Files

- `evals/dataset.yaml` - Test cases with various rubric patterns
- `evals/rubrics/` - External rubric files
