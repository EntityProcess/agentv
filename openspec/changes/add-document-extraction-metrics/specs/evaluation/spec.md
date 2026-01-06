## ADDED Requirements

### Requirement: Code Judge Result Details Passthrough

The system SHALL support optional structured details emitted by a `code_judge` evaluator and preserve them in evaluation outputs.

#### Scenario: Code judge returns details
- **GIVEN** an eval case includes a `code_judge` evaluator
- **AND** the code judge script outputs a valid result object including `score` and optional `details`
- **WHEN** the evaluation runtime parses the result
- **THEN** the evaluator result in `evaluator_results` includes the `details` payload
- **AND** the JSONL output record includes the same `details` payload under that evaluator result

#### Scenario: Code judge omits details
- **GIVEN** an eval case includes a `code_judge` evaluator
- **AND** the code judge script outputs a valid result object with only `score`/`hits`/`misses`/`reasoning`
- **WHEN** the evaluation runtime parses the result
- **THEN** evaluation output is unchanged compared to prior behavior (no `details` field added)

#### Scenario: Details payload is not valid JSON
- **GIVEN** a code judge script outputs a result with a non-JSON `details` payload
- **WHEN** the evaluation runtime parses the result
- **THEN** the evaluator result is treated as a failure with `score: 0` and an actionable error message
