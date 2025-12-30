## ADDED Requirements

### Requirement: Result Aggregator Interface

The system SHALL provide a `ResultAggregator` interface for computing aggregate metrics from evaluation results.

#### Scenario: Aggregator receives all results

- **WHEN** an evaluation run completes
- **AND** aggregators are configured
- **THEN** each aggregator receives the complete `EvaluationResult[]` array
- **AND** returns an `AggregatorOutput` with `name`, `metrics` (key-value pairs), and optional `details`

#### Scenario: Aggregator output structure

- **GIVEN** an aggregator computes metrics
- **WHEN** it returns output
- **THEN** the output includes `name` (string), `metrics` (Record<string, number>), and optional `details` (unknown)
- **AND** `metrics` values are numeric for consistent formatting

### Requirement: Built-in Basic Stats Aggregator

The system SHALL provide a `basic-stats` aggregator that computes standard summary statistics.

#### Scenario: Compute basic statistics

- **WHEN** the `basic-stats` aggregator runs
- **THEN** it computes `mean`, `median`, `min`, `max`, `standardDeviation` from result scores
- **AND** builds a histogram with bins `[0,0.2)`, `[0.2,0.4)`, `[0.4,0.6)`, `[0.6,0.8)`, `[0.8,1.0]`
- **AND** includes `total`, `errorCount`, top/bottom results in details

#### Scenario: Default aggregator

- **WHEN** no aggregators are explicitly configured
- **THEN** the system runs `basic-stats` by default
- **AND** displays the summary as currently implemented

### Requirement: Built-in Pass Rate Aggregator

The system SHALL provide a `pass-rate` aggregator that computes the percentage of cases meeting a threshold.

#### Scenario: Compute pass rate with default threshold

- **WHEN** the `pass-rate` aggregator runs without configuration
- **THEN** it uses threshold `0.8` (pass verdict threshold)
- **AND** returns `passRate` as percentage of cases with `score >= threshold`
- **AND** returns `passCount` and `failCount` in metrics

#### Scenario: Compute pass rate with custom threshold

- **GIVEN** aggregator config `{ threshold: 0.5 }`
- **WHEN** the `pass-rate` aggregator runs
- **THEN** it uses the configured threshold
- **AND** returns metrics relative to that threshold

### Requirement: Built-in Confusion Matrix Aggregator

The system SHALL provide a `confusion-matrix` aggregator for classification tasks.

#### Scenario: Parse predictions from evaluator output

- **GIVEN** eval results with hits like `"Correct: AI=High, Expected=High"` or misses like `"Mismatch: AI=Low, Expected=High"`
- **WHEN** the `confusion-matrix` aggregator runs
- **THEN** it extracts predicted and actual classes from each result
- **AND** builds a confusion matrix mapping actual classes to predicted class counts

#### Scenario: Compute per-class precision, recall, F1

- **GIVEN** a confusion matrix with classes `[Low, Medium, High]`
- **WHEN** metrics are computed
- **THEN** for each class, the aggregator calculates:
  - `precision_<class>`: TP / (TP + FP)
  - `recall_<class>`: TP / (TP + FN)
  - `f1_<class>`: 2 * (precision * recall) / (precision + recall)
- **AND** handles division by zero by returning 0

#### Scenario: Compute macro-averaged metrics

- **WHEN** per-class metrics are computed
- **THEN** the aggregator calculates macro averages:
  - `precision_macro`: mean of per-class precision
  - `recall_macro`: mean of per-class recall
  - `f1_macro`: mean of per-class F1
- **AND** includes `accuracy`: correct / total

#### Scenario: Include confusion matrix in details

- **WHEN** the `confusion-matrix` aggregator returns output
- **THEN** `details` includes the full confusion matrix structure
- **AND** includes `classes` array and per-class sample counts

### Requirement: Custom Aggregator Loading

The system SHALL support loading custom aggregators from TypeScript or JavaScript files.

#### Scenario: Load custom aggregator from file

- **GIVEN** a file path `./my-aggregator.ts` that exports a `ResultAggregator`
- **WHEN** the aggregator is referenced by path
- **THEN** the system loads and validates the exported aggregator
- **AND** invokes it with the evaluation results

#### Scenario: Invalid aggregator file

- **GIVEN** a file that does not export a valid `ResultAggregator`
- **WHEN** the system attempts to load it
- **THEN** it throws an error with a descriptive message
- **AND** evaluation continues without that aggregator

### Requirement: CLI Aggregator Selection

The system SHALL support selecting aggregators via CLI flags.

#### Scenario: Single aggregator flag

- **WHEN** the user runs `agentv eval ./test.yaml --aggregator confusion-matrix`
- **THEN** the specified aggregator runs after evaluation
- **AND** results are displayed in the summary

#### Scenario: Multiple aggregator flags

- **WHEN** the user runs `agentv eval ./test.yaml --aggregator basic-stats --aggregator confusion-matrix`
- **THEN** both aggregators run
- **AND** results from each are displayed

#### Scenario: Custom aggregator by path

- **WHEN** the user runs `agentv eval ./test.yaml --aggregator ./custom-agg.ts`
- **THEN** the system loads the custom aggregator from the file path
- **AND** runs it alongside any built-in aggregators

### Requirement: YAML Aggregator Configuration

The system SHALL support configuring aggregators in eval YAML files.

#### Scenario: Simple aggregator list

- **GIVEN** an eval file with:
  ```yaml
  aggregators:
    - basic-stats
    - confusion-matrix
  ```
- **WHEN** evaluation runs
- **THEN** both aggregators execute with default configuration

#### Scenario: Aggregator with config

- **GIVEN** an eval file with:
  ```yaml
  aggregators:
    - name: pass-rate
      config:
        threshold: 0.9
  ```
- **WHEN** evaluation runs
- **THEN** the `pass-rate` aggregator uses the configured threshold

#### Scenario: CLI overrides YAML

- **GIVEN** an eval file configures `basic-stats` aggregator
- **AND** the user passes `--aggregator confusion-matrix`
- **WHEN** evaluation runs
- **THEN** only the CLI-specified aggregator runs
- **AND** YAML configuration is ignored

### Requirement: Aggregator Output Integration

The system SHALL include aggregator results in output files and terminal display.

#### Scenario: JSONL output includes aggregator results

- **WHEN** writing JSONL output with aggregators configured
- **THEN** the final line contains aggregator results with `type: "aggregators"`
- **AND** includes results from all configured aggregators

#### Scenario: Terminal display shows aggregator metrics

- **WHEN** displaying the evaluation summary
- **THEN** aggregator metrics are formatted and displayed
- **AND** each aggregator's metrics appear under a labeled section
