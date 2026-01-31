## MODIFIED Requirements

### Requirement: Target and Environment Resolution
The CLI SHALL resolve targets and environment variables before running evaluations.

#### Scenario: Workspace root override for agentic targets
- **WHEN** the user runs `agentv eval` with `--workspace-root <dir>`
- **THEN** `<dir>` is treated as the default working directory for agentic providers when their target configuration does not specify one
- **AND** explicit per-target settings remain highest precedence

Provider-specific expectations:
- **codex**: if target `cwd` is not set, set `cwd = <dir>`
- **claude-code**: if target `cwd` is not set, set `cwd = <dir>`
- **pi-coding-agent**: if target `cwd` is not set, set `cwd = <dir>`
- **cli**: if target `cwd` is not set, set `cwd = <dir>`
- **vscode / vscode-insiders**: if target `workspaceTemplate` is not set, synthesize a workspace template with root folder `<dir>`
