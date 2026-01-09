## Context
AgentV currently supports rubric-based evaluation by converting `rubrics` into `llm_judge` checklist items. The judge returns per-item `satisfied: boolean` checks and the runtime computes a weighted fraction score in 0..1.

External best practice (DeepEval/Confident AI) adds an additional pattern: **score-range rubrics**, where the judge chooses an integer score in 0..10 constrained by explicit ranges with concrete expected outcomes, then the framework normalizes to 0..1.

## Decision
Keep a **single rubric system** by extending the existing `rubrics` field to support an additional rubric entry shape for **score-range scoring**, without removing the existing checklist scoring.

This change also includes a **breaking rename** for checklist rubrics: `description` → `expected_outcome`.

### Proposed YAML Shape
```yaml
evaluators:
  - name: correctness
    type: llm_judge
    rubrics:
      - score_range: [0, 2]
        expected_outcome: Factually incorrect.
      - score_range: [3, 6]
        expected_outcome: Mostly correct but includes notable errors or omissions.
      - score_range: [7, 9]
        expected_outcome: Correct with minor missing details.
      - score_range: [10, 10]
        expected_outcome: Fully correct and complete.
```

### Output Contract
- Judge returns `score` as an **integer** in `0..10`.
- AgentV normalizes to `0..1` by dividing by 10.
- Preserve existing verdict thresholds (`>=0.8 pass`, `>=0.6 borderline`, else fail) and required-item behavior for checklist mode.

## Validation Rules
- Ranges are inclusive integer bounds.
- Bounds must be within 0..10.
- No overlap.
- Must cover 0..10 inclusive.
- Each range must have non-empty `expected_outcome`.

## Backwards Compatibility
- If `rubrics` contains checklist entries, existing checklist behavior remains the default.
- If `rubrics` contains score-range entries, range scoring is used.
- To avoid ambiguous mixing, the proposal treats `rubrics` as **either all checklist or all score-range entries**.

### Migration
- Replace checklist rubric object field `description:` with `expected_outcome:`.

## Open Questions
- Should AgentV allow gaps (e.g., reserve 0 for “unscorable”), or strictly require full coverage? (Proposal defaults to strict full coverage to match the cited best practice.)
- Should mixed `rubrics` (checklist + score-range) be allowed, and if so how to combine them? (Proposal: disallow mixing for simplicity and determinism.)

## Deterministic Mapping to Checklist (Weighted-Average) Rubrics

### Can score-range rubrics be deterministically mapped to the existing weighted-average system?
Not in a semantics-preserving way.

Score-range rubrics define a *single holistic ordinal grade* (an integer 0..10) with an expected outcome per interval.
Checklist rubrics define *multiple independent criteria* with per-criterion weights and required flags, and compute a weighted fraction.

Because the score-range system does not provide per-criterion truth values (or even a breakdown of which expectations were met), there is no deterministic transformation from a range choice into a unique checklist satisfaction vector.
Any mapping from range → checklist would require adding assumptions (e.g., “a 7 implies all requirements A/B/C are satisfied”), which is equivalent to inventing extra semantics not present in the input.

### Can checklist rubrics be deterministically mapped to score-range rubrics?
Only in a lossy, wrapper-style way.

Given checklist results, AgentV can deterministically compute a normalized score $s \in [0,1]$ and then map it to a raw integer $r = \mathrm{round}(10s)$ (or $\lfloor 10s \rfloor$, etc.).
But that does not recreate the score-range *rubric definition* (expected outcomes per bucket), and it does not provide the core value of range rubrics: constraining the judge with explicit outcome descriptions per range.

### Conclusion
The two rubric modes are not redundant:
- Checklist rubrics are best for requirement-driven grading (decomposable criteria, required flags, deterministic scoring).
- Score-range rubrics are best for holistic grading where the evaluator needs explicit outcome descriptions per band.

The most practical unification is at the interface level: treat both as rubric-driven evaluators that produce a normalized $[0,1]$ score and a verdict, but keep both scoring modes as first-class options rather than making one a wrapper for the other.
