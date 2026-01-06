## MODIFIED Requirements
### Requirement: Concurrency and Worker Scheduling

The CLI SHALL schedule work across eval files and cases within configured worker limits.

#### Scenario: Worker limits and validation

- **WHEN** the user provides `--workers <count>`
- **THEN** the CLI enforces a minimum of 1 and maximum of 50 workers (erroring when out of range)
- **AND** defaults to 1 worker when the flag is omitted or non-numeric

#### Scenario: File-level worker balancing

- **WHEN** multiple eval files are provided with `--workers N`
- **THEN** the CLI assigns at least one worker per file up to `N`, dividing remaining workers evenly per file to cap in-flight evals

#### Scenario: VS Code worker cap (focused mode)

- **WHEN** the selected target is `vscode`/`vscode-insiders`
- **AND** the target does NOT set `vscode_instance_mode: isolated`
- **THEN** the CLI limits workers to 1 (with a warning when a higher value was requested) to avoid window-focus contention

#### Scenario: VS Code isolation enables concurrency

- **WHEN** the selected target is `vscode`/`vscode-insiders`
- **AND** the target sets `vscode_instance_mode: isolated`
- **THEN** the CLI allows the configured worker count within bounds
- **AND** provisions a matching number of subagents before execution
