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

---

## Example Judges Behavior (non-normative, for reference)

The following scenarios document expected behavior of the example `code_judge` scripts shipped in `examples/features/document-extraction/`. These are not core requirements but serve as acceptance criteria for the example implementation.

### Header Field Confusion Metrics Judge

#### Scenario: Correct non-empty value (True Positive)
- **GIVEN** expected header field value is `"ACME Corp"`
- **AND** parsed header field value is `"ACME Corp"`
- **WHEN** the judge evaluates this field
- **THEN** the field is classified as TP (true positive)

#### Scenario: Correct empty value (True Negative)
- **GIVEN** expected header field value is `""` (empty)
- **AND** parsed header field value is `""` (empty)
- **WHEN** the judge evaluates this field
- **THEN** the field is classified as TN (true negative)

#### Scenario: Wrong non-empty value (False Positive + False Negative)
- **GIVEN** expected header field value is `"ACME Corp"`
- **AND** parsed header field value is `"Beta Inc"`
- **WHEN** the judge evaluates this field
- **THEN** the field increments both FP and FN by 1

#### Scenario: Hallucinated value (False Positive)
- **GIVEN** expected header field value is `""` (empty)
- **AND** parsed header field value is `"Hallucinated Corp"`
- **WHEN** the judge evaluates this field
- **THEN** the field is classified as FP (false positive)

#### Scenario: Missing value (False Negative)
- **GIVEN** expected header field value is `"ACME Corp"`
- **AND** parsed header field value is `""` (empty)
- **WHEN** the judge evaluates this field
- **THEN** the field is classified as FN (false negative)

### Line Item Matching Judge

#### Scenario: Reordered line items matched correctly
- **GIVEN** expected line items are `[{desc: "Item A"}, {desc: "Item B"}]`
- **AND** parsed line items are `[{desc: "Item B"}, {desc: "Item A"}]`
- **WHEN** the judge matches line items
- **THEN** `Item A` is matched to `Item A` and `Item B` is matched to `Item B`
- **AND** both pairs are evaluated for field-level accuracy

#### Scenario: Unmatched expected item counts as FN
- **GIVEN** expected line items are `[{desc: "Item A"}, {desc: "Item B"}]`
- **AND** parsed line items are `[{desc: "Item A"}]`
- **WHEN** the judge matches line items
- **THEN** `Item B` is unmatched
- **AND** all fields of `Item B` contribute to FN counts

#### Scenario: Extra parsed item counts as FP
- **GIVEN** expected line items are `[{desc: "Item A"}]`
- **AND** parsed line items are `[{desc: "Item A"}, {desc: "Item C"}]`
- **WHEN** the judge matches line items
- **THEN** `Item C` is unmatched
- **AND** all non-empty fields of `Item C` contribute to FP counts
