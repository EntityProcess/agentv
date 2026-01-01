# Spec: Structured Data Evaluators

## Purpose
Provides universal primitives for comparing extracted structured data against expected values, supporting field-level accuracy validation, fuzzy matching, and numeric tolerance checks commonly needed in document extraction, data quality assessment, and structured output validation.

## ADDED Requirements

### Requirement: Field Accuracy Evaluator MUST support exact matching

The system SHALL provide a `field_accuracy` evaluator that compares extracted field values against expected values using exact equality.

#### Scenario: Exact string match succeeds
- **GIVEN** an eval case with extracted data `{ invoice: { number: "INV-001" } }`
- **AND** a field_accuracy evaluator configured with:
  ```yaml
  evaluators:
    - type: field_accuracy
      fields:
        - path: invoice.number
          match: exact
  ```
- **AND** expected data `{ invoice: { number: "INV-001" } }`
- **WHEN** the evaluator executes
- **THEN** the field score is 1.0
- **AND** `hits` includes "invoice.number"
- **AND** `misses` is empty

#### Scenario: Exact match fails on mismatch
- **GIVEN** an eval case with extracted data `{ invoice: { number: "INV-001" } }`
- **AND** expected data `{ invoice: { number: "INV-002" } }`
- **WHEN** the evaluator executes with exact matching
- **THEN** the field score is 0.0
- **AND** `misses` includes "invoice.number"
- **AND** `hits` is empty

#### Scenario: Handle missing fields
- **GIVEN** an eval case with extracted data `{ invoice: {} }`
- **AND** expected data `{ invoice: { number: "INV-001" } }`
- **AND** field configured with `required: true`
- **WHEN** the evaluator executes
- **THEN** the field score is 0.0
- **AND** `misses` includes "invoice.number (missing)"

### Requirement: Field Accuracy Evaluator MUST support numeric tolerance

The system SHALL support comparing numeric fields with configurable absolute or relative tolerance.

#### Scenario: Absolute tolerance succeeds within threshold
- **GIVEN** extracted data `{ invoice: { total: 100.02 } }`
- **AND** expected data `{ invoice: { total: 100.00 } }`
- **AND** evaluator configured with:
  ```yaml
  fields:
    - path: invoice.total
      match: numeric_tolerance
      tolerance: 0.05
      relative: false
  ```
- **WHEN** the evaluator executes
- **THEN** the field score is 1.0 (|100.02 - 100.00| = 0.02 < 0.05)

#### Scenario: Relative tolerance succeeds within percentage
- **GIVEN** extracted data `{ invoice: { total: 101.00 } }`
- **AND** expected data `{ invoice: { total: 100.00 } }`
- **AND** evaluator configured with:
  ```yaml
  fields:
    - path: invoice.total
      match: numeric_tolerance
      tolerance: 0.02
      relative: true
  ```
- **WHEN** the evaluator executes
- **THEN** the field score is 1.0 (|101 - 100| / 100 = 0.01 < 0.02)

#### Scenario: Numeric tolerance fails outside threshold
- **GIVEN** extracted data `{ invoice: { total: 105.00 } }`
- **AND** expected data `{ invoice: { total: 100.00 } }`
- **AND** evaluator configured with absolute tolerance 1.0
- **WHEN** the evaluator executes
- **THEN** the field score is 0.0 (|105 - 100| = 5.0 > 1.0)

### Requirement: Field Accuracy Evaluator MUST support fuzzy string matching

The system SHALL support fuzzy string comparison using Levenshtein or Jaro-Winkler distance with configurable thresholds.

#### Scenario: Fuzzy match succeeds above threshold
- **GIVEN** extracted data `{ vendor: { name: "Acme Corp" } }`
- **AND** expected data `{ vendor: { name: "ACME CORP" } }`
- **AND** evaluator configured with:
  ```yaml
  fields:
    - path: vendor.name
      match: fuzzy
      algorithm: levenshtein
      threshold: 0.80
  ```
- **WHEN** the evaluator executes
- **THEN** the similarity score is computed (e.g., 0.89)
- **AND** the field passes because 0.89 > 0.80
- **AND** the normalized field score reflects the similarity (0.89)

#### Scenario: Fuzzy match with Jaro-Winkler for prefix similarity
- **GIVEN** extracted data `{ vendor: { name: "Microsoft Corp" } }`
- **AND** expected data `{ vendor: { name: "Microsoft Corporation" } }`
- **AND** evaluator configured with:
  ```yaml
  fields:
    - path: vendor.name
      match: fuzzy
      algorithm: jaro_winkler
      threshold: 0.85
  ```
- **WHEN** the evaluator executes
- **THEN** Jaro-Winkler score is computed (emphasizing prefix match)
- **AND** the field passes if score > 0.85

#### Scenario: Fuzzy match fails below threshold
- **GIVEN** extracted data `{ vendor: { name: "XYZ Inc" } }`
- **AND** expected data `{ vendor: { name: "Acme Corp" } }`
- **AND** evaluator configured with threshold 0.80
- **WHEN** the evaluator executes
- **THEN** the similarity score is low (e.g., 0.15)
- **AND** the field fails because 0.15 < 0.80
- **AND** `misses` includes "vendor.name"

### Requirement: Field Accuracy Evaluator MUST support nested field paths

The system SHALL resolve nested field paths using dot notation (e.g., `invoice.line_items[0].amount`).

#### Scenario: Nested object field access
- **GIVEN** extracted data `{ invoice: { vendor: { address: { city: "Seattle" } } } }`
- **AND** field path `invoice.vendor.address.city`
- **WHEN** the evaluator resolves the path
- **THEN** the value "Seattle" is extracted

#### Scenario: Array index access in path
- **GIVEN** extracted data `{ invoice: { line_items: [{ amount: 50.00 }, { amount: 75.00 }] } }`
- **AND** field path `invoice.line_items[0].amount`
- **WHEN** the evaluator resolves the path
- **THEN** the value 50.00 is extracted

#### Scenario: Invalid path returns undefined
- **GIVEN** extracted data `{ invoice: { total: 100 } }`
- **AND** field path `invoice.vendor.name`
- **WHEN** the evaluator resolves the path
- **THEN** the value is undefined
- **AND** if field is `required: true`, this counts as a miss

### Requirement: Field Accuracy Evaluator MUST support weighted aggregation

The system SHALL aggregate per-field scores using weighted average or all-or-nothing strategies.

#### Scenario: Weighted average aggregation
- **GIVEN** three fields with weights [1.0, 0.5, 0.8] and scores [1.0, 0.0, 1.0]
- **AND** evaluator configured with `aggregation: weighted_average`
- **WHEN** the evaluator computes final score
- **THEN** score = (1.0×1.0 + 0.5×0.0 + 0.8×1.0) / (1.0 + 0.5 + 0.8)
- **AND** score = 1.8 / 2.3 ≈ 0.783

#### Scenario: All-or-nothing aggregation
- **GIVEN** three fields with scores [1.0, 1.0, 0.0]
- **AND** evaluator configured with `aggregation: all_or_nothing`
- **WHEN** the evaluator computes final score
- **THEN** score = 0.0 (because at least one field failed)

#### Scenario: All-or-nothing passes when all fields match
- **GIVEN** three fields with scores [1.0, 1.0, 1.0]
- **AND** evaluator configured with `aggregation: all_or_nothing`
- **WHEN** the evaluator computes final score
- **THEN** score = 1.0

### Requirement: Field Accuracy Evaluator MUST return structured results

The system SHALL return evaluation results with `score`, `verdict`, `hits`, `misses`, and optional `reasoning`.

#### Scenario: Structured result for mixed match
- **GIVEN** evaluator compares 4 fields with 3 matches and 1 miss
- **WHEN** evaluation completes
- **THEN** result includes:
  - `score: 0.75` (or weighted average)
  - `verdict: "partial"`
  - `hits: ["invoice.number", "invoice.date", "invoice.vendor"]`
  - `misses: ["invoice.total"]`
  - `reasoning: "3/4 fields matched"`

#### Scenario: Perfect match result
- **GIVEN** all fields match expectations
- **WHEN** evaluation completes
- **THEN** result includes:
  - `score: 1.0`
  - `verdict: "pass"`
  - `hits: [all field paths]`
  - `misses: []`

### Requirement: Field Accuracy Evaluator configuration MUST be validated

The system SHALL validate evaluator configuration at YAML parse time.

#### Scenario: Reject invalid match type
- **GIVEN** evaluator configured with `match: invalid_type`
- **WHEN** the YAML parser loads the config
- **THEN** validation fails with error "Invalid match type: invalid_type"
- **AND** suggests valid types: exact, fuzzy, numeric_tolerance

#### Scenario: Require threshold for fuzzy matching
- **GIVEN** evaluator configured with:
  ```yaml
  fields:
    - path: vendor.name
      match: fuzzy
  ```
- **AND** no `threshold` specified
- **WHEN** validation runs
- **THEN** validation fails or uses default threshold 0.85

#### Scenario: Reject non-numeric tolerance values
- **GIVEN** evaluator configured with `tolerance: "not a number"`
- **WHEN** validation runs
- **THEN** validation fails with type error

### Requirement: Field Accuracy Evaluator MUST handle edge cases gracefully

The system SHALL handle null/undefined values, type mismatches, and malformed data without throwing errors.

#### Scenario: Null extracted value vs non-null expected
- **GIVEN** extracted data `{ invoice: { total: null } }`
- **AND** expected data `{ invoice: { total: 100 } }`
- **WHEN** evaluator executes
- **THEN** field score is 0.0
- **AND** `misses` includes "invoice.total (null value)"
- **AND** no exception is thrown

#### Scenario: Type mismatch (string vs number)
- **GIVEN** extracted data `{ invoice: { total: "100" } }`
- **AND** expected data `{ invoice: { total: 100 } }`
- **AND** match type `exact`
- **WHEN** evaluator executes
- **THEN** field score is 0.0 (strict type comparison)
- **AND** `misses` includes "invoice.total (type mismatch)"

#### Scenario: Malformed field path
- **GIVEN** field path `invoice..total` (double dot)
- **WHEN** path resolution occurs
- **THEN** returns undefined without error
- **AND** logs warning about malformed path

### Requirement: Field Accuracy Evaluator MUST support optional fields

The system SHALL distinguish between required and optional fields, only penalizing missing required fields.

#### Scenario: Optional field missing does not affect score
- **GIVEN** evaluator configured with:
  ```yaml
  fields:
    - path: invoice.number
      required: true
    - path: invoice.notes
      required: false
  ```
- **AND** extracted data `{ invoice: { number: "INV-001" } }`
- **AND** expected data `{ invoice: { number: "INV-001", notes: "Rush order" } }`
- **WHEN** evaluator executes
- **THEN** only required field affects score
- **AND** score reflects invoice.number match only
- **AND** `misses` does not include optional missing fields

#### Scenario: Required field missing fails evaluation
- **GIVEN** required field `invoice.number` is missing from extracted data
- **WHEN** evaluator executes
- **THEN** field contributes 0.0 to score
- **AND** `misses` includes "invoice.number (required, missing)"
