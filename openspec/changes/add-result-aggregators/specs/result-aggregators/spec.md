## ADDED Requirements

### Requirement: Confusion Matrix Aggregator

The system SHALL provide a `confusion-matrix` aggregator for multi-class classification evaluation.

#### Scenario: Classification metrics definitions

- **GIVEN** a classification task with predicted and actual class labels
- **THEN** the following standard definitions apply per class:
  - **Precision**: TP / (TP + FP) — "Of predictions for this class, how many were correct?"
  - **Recall**: TP / (TP + FN) — "Of actual instances of this class, how many were found?"
  - **F1 Score**: 2 × (Precision × Recall) / (Precision + Recall) — harmonic mean
- **AND** TP = True Positive, FP = False Positive, FN = False Negative

#### Scenario: Extract predictions from evaluator output

- **WHEN** the `confusion-matrix` aggregator runs
- **THEN** it extracts predicted and actual class labels from result `hits` and `misses` arrays

#### Scenario: Compute per-class and aggregate metrics

- **WHEN** predictions are extracted
- **THEN** the aggregator returns metrics:
  - `precision_<class>`, `recall_<class>`, `f1_<class>` for each discovered class
  - `precision_macro`, `recall_macro`, `f1_macro` (arithmetic means)
  - `accuracy` (correct / total)
- **AND** returns 0 for any metric with division by zero

#### Scenario: Handle missing or invalid predictions

- **WHEN** some results cannot be parsed or no predictions are found
- **THEN** the aggregator handles gracefully and indicates the issue in output

### Requirement: CLI Aggregator Flag

The system SHALL support invoking aggregators via CLI flag.

#### Scenario: Confusion matrix flag

- **WHEN** the user runs `agentv eval ./test.yaml --aggregator confusion-matrix`
- **THEN** the confusion-matrix aggregator runs after evaluation completes
- **AND** metrics are displayed in the terminal summary
- **AND** results are included in the output file
