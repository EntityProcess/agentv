## 1. Schema & Types
- [x] 1.1 Add `ScoreRange` and `RubricCriterion` types (per-criterion 0–10 integer ranges) to core evaluation types
- [x] 1.2 Extend rubric criteria to accept `score_ranges` and `required_min_score` (deprecate `required`)

## 2. Validation
- [x] 2.1 Validate ranges are integers within 0..10 and start <= end
- [x] 2.2 Validate non-overlap within each criterion's ranges
- [x] 2.3 Validate (preferred) full coverage of 0..10 inclusive per criterion
- [x] 2.4 Validate each range has non-empty `expected_outcome`
- [x] 2.5 Validate `required_min_score` is an integer within 0..10

## 3. LLM Judge Integration
- [x] 3.1 Add prompt template for per-criterion score-range scoring that requests integer `score` 0..10 per rubric `id`
- [x] 3.2 Normalize criterion scores to 0..1 (divide by 10) and aggregate deterministically (weighted average)
- [x] 3.3 Apply `required_min_score` gating (force fail when any gated criterion is below threshold)
- [x] 3.4 Store raw 0–10 scores in `details` (or `evaluatorRawRequest/Response`) for debugging

## 4. YAML Support
- [x] 4.1 Support `score_ranges` nested under each rubric criterion in YAML
- [x] 4.2 Support `required_min_score` in YAML and treat legacy `required: true` as `required_min_score: 10`

## 5. Tests
- [x] 5.1 Unit tests for validation (overlap, gaps, bounds)
- [x] 5.2 Unit/integration tests for llm_judge parsing + normalization + gating

## 6. Docs
- [x] 6.1 Update rubric-evaluator skill/reference docs to include range rubrics
- [x] 6.2 Add examples of good/bad range definitions
