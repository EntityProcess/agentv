## MODIFIED Requirements

### Requirement: Static Rubric Evaluation MUST support checklist and score-range rubrics
The evaluator SHALL support rubric-based grading using a single `rubrics` field in one of two shapes:

1) **Checklist rubrics** (BREAKING rename): per-item boolean checks with weighted aggregation, using `expected_outcome` (formerly `description`).
2) **Score-range rubrics** (new, optional): a set of non-overlapping integer score ranges over 0–10 inclusive, each with an explicit `expected_outcome`.

If score-range rubrics are configured, the evaluator SHALL instruct the judge to output a **single integer score** in 0..10 and then normalize it to 0..1 for the reported evaluation score.

The system SHALL reject ambiguous configurations where `rubrics` mixes checklist and score-range entries.

#### Scenario: Checklist rubrics continue to work
- **GIVEN** an eval case with `rubrics` (id/description/weight/required)
- **WHEN** the rubric evaluator runs
- **THEN** it SHALL grade using per-item boolean checks
- **AND** the reported score SHALL be in 0..1

#### Scenario: Range rubrics constrain scoring
- **GIVEN** an eval case with `rubrics` consisting of multiple `score_range` entries and `expected_outcome` text
- **WHEN** the rubric evaluator runs
- **THEN** the judge SHALL be constrained to output an integer score in 0..10
- **AND** the system SHALL normalize the score to 0..1 by dividing by 10

#### Scenario: Invalid range rubrics are rejected
- **GIVEN** a `score_rubric` with overlapping ranges or missing coverage of 0..10
- **WHEN** the eval suite is loaded
- **THEN** validation SHALL fail
- **AND** the error message SHALL indicate the violated rule (overlap, bounds, or coverage)

### Requirement: Structured Grading MUST produce validated results
The evaluator SHALL validate judge output against a schema appropriate to the configured mode.

#### Scenario: Range rubric output schema
- **GIVEN** a range-rubric configuration
- **WHEN** the judge responds
- **THEN** the evaluator SHALL accept a JSON object matching:
```typescript
z.object({
  score: z.number().int().min(0).max(10),
  reasoning: z.string().optional(),
})
```
- **AND** AgentV SHALL normalize `score / 10` into the standard 0..1 result.
