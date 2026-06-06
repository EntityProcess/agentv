# Rubric Grader Example

Demonstrates rubric-based evaluation with weights, required flags, and auto-generation.

## What This Shows

- Inline rubrics as strings
- Rubric objects with weights
- Required vs optional criteria
- Criterion operators for correctness and contradiction guards
- Auto-generating rubrics from criteria
- Rubric file references

## Running

```bash
# From repository root
bun agentv eval examples/features/rubric/evals/dataset.eval.yaml --target default
```

## Key Files

- `evals/dataset.eval.yaml` - Test cases with various rubric patterns
- `evals/operators.eval.yaml` - Focused example of correctness and contradiction operators
- `evals/rubrics/` - External rubric files
