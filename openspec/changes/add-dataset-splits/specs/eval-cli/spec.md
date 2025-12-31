## ADDED Requirements

### Requirement: Dataset Split Filtering

The CLI SHALL support filtering eval files by split name using filename conventions.

#### Scenario: Split naming convention

- **WHEN** eval files follow naming pattern `*-{split}.yaml` or `*_{split}.yaml`
- **THEN** the CLI recognizes the split name from the filename
- **AND** common split names include `train`, `val`, `ci`, `test`

#### Scenario: Filter by split

- **WHEN** the user provides `--split <name>` to the eval command
- **THEN** the CLI filters resolved eval files to only those matching the split pattern
- **AND** matching is case-insensitive
- **AND** files without a recognized split pattern are excluded

#### Scenario: No matching files error

- **WHEN** the user provides `--split <name>` and no files match
- **THEN** the CLI fails with an error message listing the expected patterns

#### Scenario: No split filter

- **WHEN** the user omits `--split`
- **THEN** the CLI runs all resolved eval files regardless of split naming
