---
"@agentv/core": minor
"agentv": minor
---

Add score_ranges rubrics for analytic LLM judge evaluation

- Add `score_ranges` field for 0-10 integer scoring per rubric criterion
- Add `required_min_score` field for flexible gating (replaces boolean `required`)
- Add `description` as backward-compatible alias for `expected_outcome`
- Validate score ranges: integers 0-10, non-overlapping, full coverage
- Normalize scores to 0-1 (divide by 10) with weighted aggregation
- Legacy `required: true` treated as `required_min_score: 10`
