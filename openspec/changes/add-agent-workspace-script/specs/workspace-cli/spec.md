## ADDED Requirements

### Requirement: Workspace create command
The system SHALL provide a CLI command to create an agent workspace directory and a workspace config file used to sync assets into that directory.

#### Scenario: Create workspace with config
- **WHEN** the user runs `agentv workspace create --out <dir>`
- **THEN** the CLI creates `<dir>` (including parent directories)
- **AND** writes a workspace config file at `<dir>/.agentv/workspace.yaml` (unless `--config` is provided)
- **AND** the config file is versioned and supports multiple sources

#### Scenario: Default output path
- **WHEN** `--out` is omitted
- **THEN** the CLI creates a workspace directory under `.agentv/workspaces/<timestamp>` relative to the current working directory

#### Scenario: Existing output directory
- **WHEN** the output directory already exists and is non-empty
- **THEN** the CLI fails with a clear error
- **UNLESS** `--force` is provided, in which case the CLI overwrites the destination

### Requirement: Workspace sync command
The system SHALL provide a CLI command to sync a workspace directory from one or more configured sources.

#### Scenario: Sync all sources
- **WHEN** the user runs `agentv workspace sync --config <path>`
- **THEN** the CLI reads `<path>` and syncs all configured sources into the workspace root
- **AND** in `copy` mode, updates the workspace by copying files from each source include path into its destination

#### Scenario: Symlink mode
- **WHEN** the workspace is configured for `symlink` mode (or `--mode symlink` is passed)
- **THEN** the CLI uses symlinks where supported instead of copying
- **AND** failures to create symlinks produce a clear error message

#### Scenario: Git sources with folder includes
- **WHEN** a source is `type: git` with `include` folders
- **THEN** the CLI syncs only those folders (e.g., via sparse checkout) rather than cloning the entire repository contents
