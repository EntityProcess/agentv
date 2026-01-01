## ADDED Requirements

### Requirement: Claude CLI provider

The system SHALL integrate with the Claude Code CLI (`claude`) as a first-class provider for evaluating Claude Code agent outputs.

#### Scenario: Claude provider invocation

- **WHEN** a target uses `provider: claude`
- **THEN** the system ensures the Claude executable is discoverable (respecting `settings.executable`, defaulting to `claude`)
- **AND** runs `claude -p --output-format stream-json --verbose` with the prompt on stdin (plus any configured args)
- **AND** parses the JSONL streaming output to extract the result and assistant messages
- **AND** returns the final assistant text as the candidate answer with `outputMessages` containing the conversation history

#### Scenario: Claude model configuration

- **WHEN** a `claude` target specifies a `model` field
- **THEN** the system passes `--model <value>` to the Claude CLI
- **AND** supports both aliases (`sonnet`, `opus`, `haiku`) and full model names (`claude-sonnet-4-5-20250929`)

#### Scenario: Claude system prompt configuration

- **WHEN** a `claude` target specifies a `system_prompt` field
- **THEN** the system passes `--system-prompt <value>` to the Claude CLI
- **AND** uses a default prompt instructing the agent to return code in its response when not configured

#### Scenario: Claude working directory

- **WHEN** a `claude` target specifies a `cwd` field
- **THEN** the CLI is executed in that directory
- **AND** creates a temporary workspace when not specified

#### Scenario: Claude timeout handling

- **WHEN** a `claude` target specifies `timeout_seconds`
- **THEN** the provider terminates the process after that duration
- **AND** returns an error indicating the timeout occurred

#### Scenario: Claude custom arguments

- **WHEN** a `claude` target specifies an `args` array
- **THEN** those arguments are passed to the Claude CLI after the built-in flags
- **AND** can be used to configure tools, permissions, or other CLI options

#### Scenario: Claude stream logging

- **WHEN** Claude execution is in progress
- **THEN** the provider streams stdout/stderr to a log file in `.agentv/logs/claude/`
- **AND** the log file path is included in the provider response metadata
- **AND** logging can be disabled via `AGENTV_CLAUDE_STREAM_LOGS=false`

#### Scenario: Claude JSONL output parsing

- **WHEN** the Claude CLI exits successfully
- **THEN** the provider parses each JSONL line from stdout
- **AND** extracts the `result` message type for the final answer
- **AND** extracts `assistant` message types for `outputMessages` with tool calls
- **AND** preserves usage metrics and cost information in the response metadata

#### Scenario: Claude error handling

- **WHEN** the Claude CLI exits with a non-zero code
- **THEN** the provider returns an error with the exit code, stderr content, and relevant stdout context
- **AND** the log file (if enabled) contains the full execution trace for debugging

#### Scenario: Claude input files

- **WHEN** a `claude` target receives a request with `inputFiles`
- **THEN** the provider includes the file contents in the prompt using preread format
- **AND** file paths are resolved relative to the working directory
