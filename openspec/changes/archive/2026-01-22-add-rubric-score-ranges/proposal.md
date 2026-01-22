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
- Extend the existing `rubrics` concept to support **per-criterion score ranges** (analytic rubric scoring):
  - Each rubric entry represents a criterion with an `id` and optional aggregation `weight`.
  - Each criterion can include `score_ranges` (0–10 inclusive integer bands) with explicit `expected_outcome` text.
  - The judge returns an integer score **0–10 per criterion**, which AgentV normalizes to **0–1** (divide by 10) and aggregates (weighted average).

- Replace `required: boolean` with `required_min_score: int` (0–10) for gating.
  - If a criterion has `required_min_score`, the overall verdict MUST be `fail` when the criterion score is below that threshold.

- Add validation rules (for per-criterion score ranges):
  - Ranges MUST be integers within **0..10**
  - Ranges MUST NOT overlap within a criterion
  - Ranges SHOULD cover **0..10** (inclusive) within a criterion (strict coverage is preferred for determinism)
  - Each range MUST include a non-empty `expected_outcome`

- Backwards compatibility:
  - Existing checklist rubrics remain supported during migration.
  - `required` is treated as a deprecated alias for `required_min_score: 10`.

## Breaking Changes
- **BREAKING**: Rename checklist rubric field `description` → `expected_outcome`.
  - YAML before:
    - `rubrics: [{ id: "x", description: "...", weight: 1, required: true }]`
  - YAML after:
    - `rubrics: [{ id: "x", expected_outcome: "...", weight: 1, required: true }]`
  - CLI `generate rubrics` output changes accordingly.

- **BREAKING (proposed new primary shape)**: Prefer `required_min_score` over `required`.
  - `required` remains accepted as a deprecated alias during migration.

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
