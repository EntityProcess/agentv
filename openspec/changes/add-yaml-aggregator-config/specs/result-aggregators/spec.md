## ADDED Requirements

### Requirement: YAML Aggregator Configuration

The system SHALL support configuring aggregators in eval YAML files.

#### Scenario: Aggregator list in YAML

- **GIVEN** an eval file with `aggregators` field
- **WHEN** evaluation runs
- **THEN** listed aggregators execute
- **AND** supports string syntax (`- confusion-matrix`) and object syntax (`- name: confusion-matrix, config: {...}`)

#### Scenario: CLI overrides YAML

- **WHEN** CLI `--aggregator` flags are provided
- **THEN** only CLI-specified aggregators run (YAML config is ignored)
