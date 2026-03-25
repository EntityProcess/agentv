# Design: `--threshold` flag for suite-level quality gates

**Issue:** #698
**Date:** 2026-03-25

## Objective

Add a `--threshold` CLI flag to `agentv eval` that fails (exit 1) if the mean score across all tests falls below the specified threshold. This enables CI/CD quality gating without needing `agentv compare --baseline`.

## CLI Flag

- `--threshold <number>` on `agentv eval run` (0–1 scale)
- Optional — if omitted, no threshold check (current behavior preserved)
- Overrides `execution.threshold` from YAML if both set

## YAML Config

Add `threshold` to the `execution` block in eval YAML files:

```yaml
execution:
  threshold: 0.8
```

Both `threshold` and `execution.threshold` accepted (snake_case wire format convention).

## Score Evaluation

After all tests complete:

1. Compute mean score from quality results only (excluding `execution_error` tests — same as existing `calculateEvaluationSummary()`)
2. If mean score < threshold → exit code 1
3. Execution errors fail independently via existing `fail_on_error` mechanism (separate concern)
4. If no quality results exist (all execution errors), threshold check is skipped

## Output

When threshold is active, append a summary line after the existing result summary:

```
Suite score: 0.53 (threshold: 0.60) — FAIL
```

or:

```
Suite score: 0.85 (threshold: 0.60) — PASS
```

## JUnit Integration

The JUnit writer uses the threshold for per-test pass/fail:

- If threshold is set: `score < threshold` → `<failure>` element
- If threshold is not set: `score < 0.5` (current hardcoded behavior preserved)

## Exit Code

- Exit 0: mean score >= threshold (or no threshold set)
- Exit 1: mean score < threshold
- Execution errors handled separately by `fail_on_error`

## Files to Modify

1. `packages/core/src/evaluation/validation/eval-file.schema.ts` — add `threshold` to ExecutionSchema
2. `apps/cli/src/commands/eval/commands/run.ts` — add `--threshold` CLI flag
3. `apps/cli/src/commands/eval/run-eval.ts` — pass threshold through, check after results
4. `apps/cli/src/commands/eval/statistics.ts` — add threshold summary formatting
5. `apps/cli/src/commands/eval/junit-writer.ts` — use threshold for pass/fail
6. Tests for new behavior

## Non-Goals

- Per-test threshold override (use `required` for that)
- Replacement for `agentv compare` regression gating
- Severity levels (#334)
