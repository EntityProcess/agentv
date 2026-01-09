## 1. Schema & Types
- [ ] 1.1 Add `ScoreRangeRubric` types (0–10 integer ranges) to core evaluation types
- [ ] 1.2 Extend evaluator config to accept optional `score_rubric` (or `score_ranges`) field

## 2. Validation
- [ ] 2.1 Validate ranges are integers within 0..10 and start <= end
- [ ] 2.2 Validate non-overlap across ranges
- [ ] 2.3 Validate full coverage of 0..10 inclusive
- [ ] 2.4 Validate each range has non-empty `expected_outcome`

## 3. LLM Judge Integration
- [ ] 3.1 Add prompt template for range-rubric scoring that requests integer `score` 0..10
- [ ] 3.2 Normalize final score to 0..1 (divide by 10) and keep existing verdict logic
- [ ] 3.3 Store raw 0–10 score in `details` (or `evaluatorRawRequest/Response`) for debugging

## 4. YAML Support
- [ ] 4.1 Support `score_rubric` in YAML evaluator config (snake_case)
- [ ] 4.2 Decide if inline `rubrics:` sugar can support range rubrics (or keep evaluator-only)

## 5. Tests
- [ ] 5.1 Unit tests for validation (overlap, gaps, bounds)
- [ ] 5.2 Unit/integration tests for llm_judge parsing + normalization

## 6. Docs
- [ ] 6.1 Update rubric-evaluator skill/reference docs to include range rubrics
- [ ] 6.2 Add examples of good/bad range definitions
