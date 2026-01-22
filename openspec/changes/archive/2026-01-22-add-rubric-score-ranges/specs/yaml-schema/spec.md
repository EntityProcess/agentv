## ADDED Requirements

### Requirement: Checklist rubric field name MUST be `expected_outcome`
The YAML schema SHALL accept checklist rubric objects using `expected_outcome` (replacing the legacy `description`).

#### Scenario: Checklist rubric uses expected_outcome
- **GIVEN** a YAML eval case with:
```yaml
rubrics:
  - id: structure
    expected_outcome: Has clear headings and organization
    weight: 1.0
    required_min_score: 10
```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds

### Requirement: Rubric gating MUST support required_min_score
The YAML schema SHALL support `required_min_score` (0..10) on rubric criteria to enforce hard-gating.

#### Scenario: required_min_score gates rubric criteria
- **GIVEN** a YAML eval case with:
```yaml
rubrics:
  - id: correctness
    weight: 2.0
    required_min_score: 10
    expected_outcome: Must be fully correct.
```
- **WHEN** the YAML is parsed
- **THEN** schema validation succeeds

### Requirement: Per-criterion score_ranges rubrics MUST be supported for LLM judging
The YAML schema SHALL support configuring per-criterion `score_ranges` for `llm_judge` evaluators via the existing `rubrics` field.

#### Scenario: Configure score_rubric
- **GIVEN** a YAML eval case with:
```yaml
evaluators:
  - name: correctness
    type: llm_judge
    rubrics:
      - id: correctness
        weight: 1.0
        required_min_score: 10
        score_ranges:
          - score_range: [0, 2]
            expected_outcome: Factually incorrect.
          - score_range: [3, 6]
            expected_outcome: Mostly correct.
          - score_range: [7, 9]
            expected_outcome: Correct but missing minor details.
          - score_range: [10, 10]
            expected_outcome: Fully correct.
```
- **WHEN** the YAML is parsed
- **THEN** the evaluator configuration SHALL include the provided score ranges

#### Scenario: Reject overlapping score ranges
- **GIVEN** a YAML eval case with overlapping ranges
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail

#### Scenario: Reject incomplete 0..10 coverage
- **GIVEN** a YAML eval case where score ranges do not cover 0..10 inclusive
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail

#### Scenario: Reject empty expected_outcome
- **GIVEN** a YAML eval case where a range rubric entry has an empty `expected_outcome`
- **WHEN** the YAML is parsed
- **THEN** schema validation SHALL fail
