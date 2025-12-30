## ADDED Requirements

### Requirement: Custom Aggregator Loading

The system SHALL support loading custom aggregators from TypeScript or JavaScript files.

#### Scenario: Load custom aggregator

- **GIVEN** a file path that exports a `ResultAggregator` (with `name` and `aggregate` properties)
- **WHEN** the user runs `agentv eval ./test.yaml --aggregator ./my-aggregator.ts`
- **THEN** the system loads and invokes the custom aggregator

#### Scenario: Invalid aggregator file

- **GIVEN** a file that does not export a valid `ResultAggregator`
- **WHEN** the system attempts to load it
- **THEN** it logs a descriptive error and exits before running evaluation
