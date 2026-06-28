# Composite Graders

Demonstrates composite grader patterns for combining multiple evaluation criteria.

## What This Shows

- Combining multiple graders in a single test case
- Weighted scoring across graders
- AND/OR logic patterns (documented in the docs page)
- Hierarchical evaluation strategies

## Running

```bash
# From repository root
bun agentv eval run examples/features/composite/evals/dataset.eval.yaml
# Validate the eval file without executing targets
bun agentv validate examples/features/composite/evals/dataset.eval.yaml
```

## Key Files

- `evals/dataset.eval.yaml` - Test cases with composite grader patterns
- `scripts/or-aggregator.js` - Strict OR aggregator script used by `composite` examples
- `apps/web/src/content/docs/docs/graders/composite.mdx` - Detailed AND/OR and strict-OR composition guidance
