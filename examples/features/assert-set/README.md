# Assert Sets

Demonstrates `assert-set` patterns for grouping multiple evaluation criteria.

## What This Shows

- Combining multiple assertions in a single test case
- Weighted scoring across child assertions
- Threshold gates for grouped assertions
- Hierarchical assertion groups

## Running

```bash
# From repository root
bun agentv eval run examples/features/assert-set/evals/suite.yaml
# Validate the eval file without executing targets
bun agentv validate examples/features/assert-set/evals/suite.yaml
```

## Key Files

- `evals/suite.yaml` - Test cases with assert-set grouping patterns
- `apps/web/src/content/docs/docs/next/graders/assert-set.mdx` - Detailed assert-set guidance
