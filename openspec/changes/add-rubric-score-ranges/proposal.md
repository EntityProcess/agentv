# Change: Add 0–10 score-range rubrics for LLM judging

## Why
AgentV’s current rubric support in `llm_judge` is a **binary checklist** (each rubric item is `satisfied: true|false` and the score is computed as a weighted fraction). This is great for requirements-style grading, but it does **not** support the “confine the judge into explicit score ranges” pattern used by common LLM-evals tooling.

Best-practice literature for LLM-as-a-judge rubric scoring (e.g., DeepEval/Confident AI) recommends:
- A **0–10 integer scale** (more reliable than floats for LLMs)
- Explicit **non-overlapping** `score_range` definitions
- Clear **expected outcomes per range**, not vague labels
- **Normalization to 0–1** for downstream aggregation

Adding this as an **optional, backwards-compatible** scoring mode gives AgentV users a deterministic way to express custom metrics while keeping existing rubrics intact.

## What Changes
- Extend the existing `rubrics` concept to support **two rubric shapes** under a single field:
  - **Checklist rubrics** (breaking rename): `{ id, expected_outcome, weight, required }`
  - **Score-range rubrics** (new, optional): `{ score_range: [start, end], expected_outcome }` over **0–10 inclusive**

  This keeps a single rubric system and a single evaluator implementation while covering both use cases.

- When the evaluator is configured with score-range rubrics, it:
  - Constrains the judge to output an integer **raw score 0–10**
  - Normalizes to **0–1** (divide by 10) for the existing `EvaluationScore.score`
- Add validation rules:
  - Ranges MUST be integers within **0..10**
  - Ranges MUST NOT overlap
  - Ranges MUST cover **0..10** (inclusive)
  - Each range MUST include a non-empty `expected_outcome`
- Preserve the current behavior:
  - Existing `llm_judge` freeform scoring (0–1) unchanged
  - Existing `llm_judge` rubric checklist scoring logic unchanged (only the field name changes)

## Breaking Changes
- **BREAKING**: Rename checklist rubric field `description` → `expected_outcome`.
  - YAML before:
    - `rubrics: [{ id: "x", description: "...", weight: 1, required: true }]`
  - YAML after:
    - `rubrics: [{ id: "x", expected_outcome: "...", weight: 1, required: true }]`
  - CLI `generate rubrics` output changes accordingly.

## Impact
- Affected specs: `rubric-evaluator`, `yaml-schema`.
- Affected code (expected):
  - `packages/core/src/evaluation/types.ts` (new config/type)
  - `packages/core/src/evaluation/yaml-parser.ts` (parsing inline config)
  - `packages/core/src/evaluation/loaders/evaluator-parser.ts` (validation)
  - `packages/core/src/evaluation/evaluators/llm-judge.ts` (prompt + scoring)
  - `packages/core/src/evaluation/validation/*` (range validation helper)
  - Tests under `packages/core/test/**`

## Non-Goals
- Do not replace checklist rubrics.
- Do not change `EvaluationScore.score` away from 0–1.
- Do not add new CLI UX beyond schema support (future enhancement could generate range rubrics).
