## ADDED Requirements

### Requirement: Code judge MAY invoke configured judge provider (opt-in)

The system SHALL allow a `code_judge` evaluator to invoke the configured judge provider **without exposing provider credentials to the external script**, when explicitly enabled.

#### Scenario: Enable judge access for a code_judge evaluator
- **GIVEN** an eval case with a `code_judge` evaluator configured with `use_judge_provider: true`
- **AND** a judge provider is available in the evaluation context
- **WHEN** the runtime invokes the code judge script
- **THEN** the script is provided a loopback proxy URL and short-lived auth token via environment variables
- **AND** the script can request judge invocations through the proxy

#### Scenario: Disabled by default
- **GIVEN** an eval case with a `code_judge` evaluator
- **WHEN** `use_judge_provider` is not set (or is `false`)
- **THEN** no judge proxy environment variables are provided
- **AND** existing code judges continue to function unchanged

#### Scenario: No judge provider available
- **GIVEN** an eval case with a `code_judge` evaluator configured with `use_judge_provider: true`
- **AND** no judge provider is available in the evaluation context
- **WHEN** the runtime invokes the code judge script
- **THEN** the runtime SHALL fail the evaluator (score 0) with an actionable error message

### Requirement: Judge proxy MUST be authenticated and loopback-only

The system SHALL expose judge invocations to code_judge scripts only via an authenticated proxy bound to loopback.

#### Scenario: Proxy rejects unauthenticated requests
- **GIVEN** the judge proxy is running
- **WHEN** a request is received without a valid `Authorization: Bearer <token>` header
- **THEN** the proxy responds with HTTP 401

#### Scenario: Proxy binds to loopback only
- **WHEN** the judge proxy is started
- **THEN** it binds to a loopback interface only (e.g., `127.0.0.1`)
- **AND** it is not reachable from non-local interfaces

### Requirement: Judge proxy MUST enforce a per-evaluator call limit

The system SHALL enforce a maximum number of judge invocations per `code_judge` execution.

#### Scenario: Default call limit
- **GIVEN** `use_judge_provider: true`
- **AND** no `judge_provider.max_calls` is configured
- **WHEN** the code judge invokes the proxy repeatedly
- **THEN** the runtime enforces a default maximum call count

#### Scenario: Configured call limit
- **GIVEN** `use_judge_provider: true`
- **AND** `judge_provider.max_calls: 10` is configured
- **WHEN** the script attempts an 11th judge invocation
- **THEN** the proxy rejects the request with an actionable error
- **AND** the evaluator run fails with score 0
