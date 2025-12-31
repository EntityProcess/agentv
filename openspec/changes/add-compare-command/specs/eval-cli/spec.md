## ADDED Requirements

### Requirement: Result Comparison Command

The CLI SHALL provide a `compare` command to analyze performance differences between two evaluation result files.

#### Scenario: Basic comparison

- **WHEN** the user runs `agentv compare <result1> <result2>`
- **THEN** the CLI loads both result files (JSONL or YAML format)
- **AND** matches results by `eval_id`
- **AND** computes score deltas (score2 - score1) for each matched case
- **AND** classifies outcomes as win/loss/tie based on threshold (default 0.1)

#### Scenario: Unmatched cases

- **WHEN** some eval_ids exist in only one file
- **THEN** the CLI reports unmatched count in summary
- **AND** unmatched cases are excluded from statistical analysis

#### Scenario: Summary statistics

- **WHEN** comparison completes
- **THEN** the CLI reports total cases, matched/unmatched counts, wins/losses/ties
- **AND** computes mean and median deltas
- **AND** computes mean scores for each file
- **AND** optionally includes standard deviation when sufficient samples exist

#### Scenario: Statistical significance

- **WHEN** sufficient matched cases exist for meaningful statistics
- **THEN** the CLI computes a p-value for the difference between runs
- **AND** reports whether the difference is statistically significant
- **AND** computes effect size with human-readable interpretation

#### Scenario: Configurable threshold

- **WHEN** the user provides `--threshold <value>`
- **THEN** the CLI uses that value as the score delta required for win/loss classification
- **AND** values below threshold magnitude are classified as ties

#### Scenario: Output formats

- **WHEN** the user provides `--format table` (default)
- **THEN** the CLI outputs a formatted table with summary and case details
- **WHEN** the user provides `--format json`
- **THEN** the CLI outputs structured JSON with full comparison data
- **WHEN** the user provides `--format markdown`
- **THEN** the CLI outputs markdown-formatted report suitable for documentation

#### Scenario: Case filtering and sorting

- **WHEN** the user omits `--all`
- **THEN** the CLI shows only wins and losses (excludes ties)
- **WHEN** the user provides `--all`
- **THEN** the CLI shows all cases including ties
- **AND** results are sorted by delta (descending) by default
- **WHEN** the user provides `--sort <field>`
- **THEN** results are sorted by the specified field (delta, score1, score2, eval_id)

#### Scenario: Exit code indicates comparison result

- **WHEN** file2 has equal or better mean score than file1
- **THEN** the CLI exits with code 0
- **WHEN** file1 has better mean score than file2
- **THEN** the CLI exits with code 1

#### Scenario: Delta visualization

- **WHEN** displaying score deltas in table or markdown format
- **THEN** the CLI uses directional indicators (↑ improvement, ↓ regression, → no change)
- **AND** applies color coding (green for improvement, red for regression)
- **AND** shows both absolute delta and percentage change where meaningful

#### Scenario: Cost and token comparison

- **WHEN** result files include cost or token usage metadata
- **THEN** the CLI computes and displays aggregate cost/token deltas
- **AND** shows percentage change in resource usage
- **WHEN** cost/token metadata is not present
- **THEN** the CLI omits these metrics without error

#### Scenario: Run metadata comparison

- **WHEN** result files include run metadata (model name, configuration)
- **THEN** the CLI displays metadata differences in summary header
- **AND** highlights configuration changes between runs
- **WHEN** metadata is not present
- **THEN** the CLI proceeds with score comparison only
