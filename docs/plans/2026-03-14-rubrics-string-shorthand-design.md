# Design: Rubrics String Shorthand in `assert`

**Issue:** #591
**Date:** 2026-03-14

## Summary

Allow plain strings in the `assert` array to be automatically treated as rubric criteria, defaulting to a single `rubrics` evaluator. This simplifies the most common eval authoring pattern.

## Before / After

Before:
```yaml
assert:
  - type: rubrics
    criteria:
      - Mentions divide-and-conquer approach
      - Explains partition step
      - States time complexity
```

After:
```yaml
assert:
  - Mentions divide-and-conquer approach
  - Explains partition step
  - States time complexity
```

## Design

**Change point:** `parseEvaluatorList` in `packages/core/src/evaluation/loaders/evaluator-parser.ts`

**Approach:** Pre-process the `candidateEvaluators` array before the main loop:

1. Scan for string entries; record the index of the first string.
2. Collect all strings into a `criteria` array.
3. Rebuild the array: replace the first string with a synthetic `{ type: 'rubrics', criteria: [...strings] }` object; remove the other string entries.
4. If no strings found, proceed unchanged.

This places the rubrics evaluator at the position of the first string in the YAML, which is the most natural ordering.

**Mixed strings and objects** are supported — strings are grouped into a single rubrics evaluator, object evaluators are preserved in their relative order (with the rubrics block inserted at the first-string position).

## Scope

- `packages/core/src/evaluation/loaders/evaluator-parser.ts` — add pre-processing in `parseEvaluatorList`
- `packages/core/test/evaluation/loaders/evaluator-parser.test.ts` — add tests
- `examples/features/rubric/evals/dataset.eval.yaml` — update Example 1 to demonstrate the shorthand
- Skill file for agentv-eval-builder — update to mention the shorthand syntax

## Non-Goals

- No schema changes
- No changes to the `rubrics` evaluator logic itself
- Existing `type: rubrics` with `criteria` continues to work unchanged
