---
name: agentv-grader-changes
description: Use when adding, modifying, renaming, parsing, or verifying AgentV graders/evaluators, assertion types, scoring behavior, thresholds, baseline files, or eval output shape.
---

# AgentV Grader Changes

## Type System

Grader types are kebab-case everywhere:

- YAML config: `llm-grader`, `is-json`, `execution-metrics`.
- Internal `EvaluatorKind`.
- Output `scores[].type`.
- Registry keys.

Source of truth: `EVALUATOR_KIND_VALUES` in `packages/core/src/evaluation/types.ts`.

Snake_case aliases can be accepted for backward compatibility through `normalizeGraderType()` in `grader-parser.ts`. SDK-facing `AssertionType` in `packages/eval/src/assertion.ts` must stay in sync.

## Verification

Unit tests are not enough for grader changes.

1. Ensure `.env` exists in the worktree.
2. Run an actual eval with a real example file:

```bash
bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id <test-id>
```

3. Inspect JSONL output:
   - correct `scores[].type`
   - expected score calculation
   - assertions have `text`, `passed`, and optional `evidence`

4. Update `*.baseline.jsonl` files when output format changes.

`--dry-run` is useful for harness plumbing but returns mock scores and cannot validate grading quality.

## Score Range Checks

For manual e2e score guardrails:

```bash
bun apps/cli/src/cli.ts eval examples/path/to/suite.eval.yaml --target azure \
  --out examples/path/to/suite.results.jsonl
bun scripts/check-grader-scores.ts
```

Add `<eval-stem>.grader-scores.yaml` next to an eval when a new suite needs score-range assertions.
