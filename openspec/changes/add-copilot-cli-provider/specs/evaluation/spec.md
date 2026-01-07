## MODIFIED Requirements

### Requirement: Provider Integration
The system SHALL integrate with supported providers using target configuration and optional retry settings.

#### Scenario: GitHub Copilot CLI provider
- **WHEN** a target uses `provider: copilot-cli` (or an accepted alias)
- **THEN** the system ensures the Copilot CLI launcher is available (defaulting to `npx` when not explicitly configured)
- **AND** builds a preread prompt document that links guideline and attachment files via `file://` URLs and includes the user query
- **AND** runs GitHub Copilot CLI via `@github/copilot` with a pinned version by default (configurable), piping the prompt via stdin
- **AND** captures stdout/stderr and extracts a single candidate answer text from the final assistant output
- **AND** on failure, the error includes exit code/timeout context and preserves stdout/stderr and any log artifacts for debugging
