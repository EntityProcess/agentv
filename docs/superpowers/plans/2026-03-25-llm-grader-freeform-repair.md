# LLM Grader Freeform Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make freeform `llm-grader` parsing resilient to narrow schema-near malformed assertion outputs like `passed: mixed` while keeping `assertions[].passed` boolean-only.

**Architecture:** Add a small repair step at the JSON parsing boundary in the shared evaluator scoring helper, then continue using existing Zod schemas for validation. Cover the behavior with evaluator-focused regression tests and document the default local `AGENT_ID` in the repository instructions.

**Tech Stack:** TypeScript, Bun test, Zod

---

### Task 1: Add failing regression tests

**Files:**
- Modify: `packages/core/test/evaluation/evaluators.test.ts`
- Test: `packages/core/test/evaluation/evaluators.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test where the grader returns:

```json
{
  "score": 0.5,
  "assertions": [
    { "text": "Partially met", "passed": mixed, "evidence": "Some criteria satisfied" }
  ]
}
```

Assert the evaluation returns `verdict: fail` or `borderline` according to score, and the assertion is preserved with `passed: false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/evaluation/evaluators.test.ts`
Expected: FAIL because the current parser skips on invalid JSON.

- [ ] **Step 3: Add a guard test for truly malformed JSON**

Add a test with unrecoverable malformed output such as `{"score":` and assert it still yields a skipped result.

- [ ] **Step 4: Run tests to verify expected red state**

Run: `bun test packages/core/test/evaluation/evaluators.test.ts`
Expected: the new recoverable-output test fails before implementation; existing malformed-output behavior stays intact.

### Task 2: Implement narrow repair logic

**Files:**
- Modify: `packages/core/src/evaluation/evaluators/scoring.ts`

- [ ] **Step 1: Implement minimal repair helper**

Add a helper that normalizes fenced JSON extraction and rewrites narrow assertion boolean tokens such as `: mixed` to `: false` before `JSON.parse`.

- [ ] **Step 2: Keep schema enforcement unchanged**

Ensure `parseJsonFromText` still returns parsed JSON that must pass the existing freeform Zod schema. Do not change `freeformEvaluationSchema`.

- [ ] **Step 3: Run the evaluator tests**

Run: `bun test packages/core/test/evaluation/evaluators.test.ts`
Expected: the new recoverable-output test now passes.

### Task 3: Document AGENT_ID default

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update issue workflow docs**

Add a note near the `AGENT_ID` instructions documenting `devbox2-codex` as the default identifier for this environment unless the user specifies another value.

- [ ] **Step 2: Run targeted verification**

Run: `bun test packages/core/test/evaluation/evaluators.test.ts`
Expected: PASS

- [ ] **Step 3: Review diff**

Run: `git diff -- packages/core/src/evaluation/evaluators/scoring.ts packages/core/test/evaluation/evaluators.test.ts CLAUDE.md docs/superpowers/specs/2026-03-25-llm-grader-freeform-repair-design.md docs/superpowers/plans/2026-03-25-llm-grader-freeform-repair.md`
Expected: only the intended parser, tests, docs, and workflow updates are present.
