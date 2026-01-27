## ADDED Requirements

### Requirement: OpenCode provider execution

The system SHALL support an OpenCode-backed provider when a target is configured with `provider: opencode`.

#### Scenario: Execute an eval case with OpenCode
- **WHEN** a target is configured with `provider: opencode`
- **AND** an eval case is executed for that target
- **THEN** the system invokes OpenCode to generate an assistant response
- **AND** runs OpenCode within an isolated per-eval-case working directory
- **AND** returns a `ProviderResponse` with `outputMessages` populated

#### Scenario: Provider fails cleanly when OpenCode is unavailable
- **WHEN** an OpenCode target is selected
- **AND** the OpenCode runtime cannot be started or reached (missing executable, failed server startup, unreachable base URL)
- **THEN** the eval case attempt fails with an actionable error message
- **AND** other eval cases continue when running in parallel

### Requirement: OpenCode provider log streaming artifacts

When an OpenCode-based provider run is executed, the system SHALL support writing a per-run stream log file and surfacing its path for debugging.

#### Scenario: Provider creates an OpenCode stream log file
- **WHEN** a provider run begins for an OpenCode-backed target
- **THEN** the provider writes a log file under `.agentv/logs/opencode/` by default (or a configured override)
- **AND** the provider appends progress entries as the agent executes

#### Scenario: Provider disables OpenCode stream logging
- **WHEN** OpenCode stream logging is disabled via configuration or environment
- **THEN** the provider does not create a log file
- **AND** evaluation continues normally

#### Scenario: Provider cannot create the OpenCode log directory
- **WHEN** the provider cannot create the configured log directory (permissions, invalid path)
- **THEN** the provider continues without stream logs
- **AND** emits a warning in verbose mode only

### Requirement: OpenCode log path publication

The system SHALL provide a mechanism to publish OpenCode log file paths so the CLI can present them to the user as soon as they are created.

#### Scenario: Publish OpenCode log path at run start
- **WHEN** the provider decides on a log file path for an OpenCode run
- **THEN** it publishes `{ filePath, targetName, evalCaseId?, attempt? }` to a process-local log tracker
- **AND** downstream consumers MAY subscribe to this tracker to display the log path

### Requirement: OpenCode tool-call trace mapping

The OpenCode provider SHALL map OpenCode tool lifecycle parts into AgentV tool calls so deterministic evaluators can operate on the trace.

#### Scenario: Tool parts become toolCalls
- **WHEN** OpenCode returns a response containing one or more `tool` parts
- **THEN** the provider emits `ProviderResponse.outputMessages` containing `toolCalls`
- **AND** each tool call includes `tool` name and `input` arguments when available
- **AND** completed tool calls include `output` when available
- **AND** tool call identifiers are stable across retries within an attempt when OpenCode provides them

#### Scenario: Tool error parts are surfaced
- **WHEN** OpenCode returns a `tool` part with error state
- **THEN** the provider includes the tool call in `toolCalls`
- **AND** includes the error information in a provider-specific metadata field or in `output` with a structured error payload

### Requirement: OpenCode permission handling

The OpenCode provider SHALL handle OpenCode permission requests deterministically based on target configuration.

#### Scenario: Default permission policy is conservative
- **WHEN** OpenCode emits a permission request during an eval case
- **AND** the target does not explicitly enable auto-approval
- **THEN** the provider rejects the request
- **AND** the eval attempt fails with a clear error describing the blocked permission

#### Scenario: Auto-approve permissions when configured
- **WHEN** OpenCode emits a permission request during an eval case
- **AND** the target is configured to auto-approve permissions
- **THEN** the provider approves the request according to the configured policy (e.g., once or always)
- **AND** execution continues normally
