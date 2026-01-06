## ADDED Requirements
### Requirement: VS Code isolated instance mode
The system SHALL support an opt-in isolated instance mode for the VS Code provider to avoid focus-based routing. Targets MAY configure `vscode_instance_mode`, `vscode_instance_root`, and `vscode_instance_count` to control this behavior.

#### Scenario: Enable isolated instances
- **GIVEN** a target uses `provider: vscode` (or `vscode-insiders`)
- **AND** the target sets `vscode_instance_mode: isolated`
- **WHEN** the provider dispatches a request
- **THEN** it assigns the request to a distinct VS Code instance up to the configured instance count
- **AND** launches the instance with unique `--user-data-dir` and `--extensions-dir` paths
- **AND** passes those instance arguments on every VS Code CLI invocation for that request

#### Scenario: Default focused mode
- **GIVEN** a target uses `provider: vscode` (or `vscode-insiders`)
- **AND** `vscode_instance_mode` is unset or `focused`
- **WHEN** the provider dispatches a request
- **THEN** it uses the existing focus-based dispatch behavior without instance isolation

#### Scenario: Instance root resolution
- **GIVEN** a target sets `vscode_instance_root`
- **WHEN** isolated instances are created
- **THEN** instance data directories are created under that root with stable per-instance subfolders (e.g., `instance-1`, `instance-2`)

#### Scenario: Instance count default
- **GIVEN** a target sets `vscode_instance_mode: isolated`
- **AND** `vscode_instance_count` is not specified
- **WHEN** the eval run provides a max concurrency value
- **THEN** the system uses that max concurrency as the instance count
- **AND** falls back to 1 when no max concurrency is available
