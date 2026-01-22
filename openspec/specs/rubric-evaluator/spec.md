# rubric-evaluator Specification

## Purpose
TBD - created by archiving change implement-rubric-evaluator. Update Purpose after archive.
## Requirements
### Requirement: Static Rubric Evaluation MUST support checklist and score-range rubrics
The evaluator SHALL support rubric-based grading using rubric criteria entries. Each criterion may be:

1) **Checklist-style** (legacy): boolean checks per criterion using `expected_outcome` text.
2) **Score-range per criterion** (new): each criterion contains `score_ranges` defining non-overlapping integer ranges over 0–10 inclusive, each with an explicit `expected_outcome`.

When score-ranges are present for a criterion, the evaluator SHALL instruct the judge to output an **integer score 0..10 for that criterion** and then normalize it to 0..1 for aggregation.

The evaluator SHALL support `required_min_score` gating: if a criterion specifies `required_min_score` and the returned score is below it, the overall verdict SHALL be `fail`.

#### Scenario: Checklist rubrics continue to work
- **GIVEN** an eval case with `rubrics` (id/description/weight/required)
- **WHEN** the rubric evaluator runs
- **THEN** it SHALL grade using per-item boolean checks
- **AND** the reported score SHALL be in 0..1

#### Scenario: Range rubrics constrain scoring
- **GIVEN** an eval case with `rubrics` where a criterion contains `score_ranges` entries and `expected_outcome` text
- **WHEN** the rubric evaluator runs
- **THEN** the judge SHALL be constrained to output an integer score in 0..10 for that criterion
- **AND** the system SHALL normalize each criterion score to 0..1 by dividing by 10

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
  checks: z.array(z.object({
    id: z.string(),
    score: z.number().int().min(0).max(10),
    reasoning: z.string().optional(),
  })),
  overall_reasoning: z.string().optional(),
})
```
- **AND** AgentV SHALL normalize per-criterion `score / 10` into the standard 0..1 result and aggregate.

### Requirement: Verdict Logic MUST be applied
The evaluator SHALL calculate the verdict based on the score and required items.

#### Scenario: Pass Verdict
Given a grading result where all required items are met and score >= 0.8
Then the verdict should be `pass`.

#### Scenario: Fail Verdict
Given a grading result where score < 0.6
Then the verdict should be `fail`.

#### Scenario: Borderline Verdict
Given a grading result where score is between 0.6 and 0.8
Then the verdict should be `borderline`.

