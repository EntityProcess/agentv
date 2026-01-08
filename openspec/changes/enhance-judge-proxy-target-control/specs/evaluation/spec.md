# Spec Delta: evaluation

## ADDED Requirements

### Requirement: Judge Proxy Info Endpoint
The judge proxy SHALL provide an info endpoint for code judges to query proxy metadata.

#### Scenario: Code judge queries proxy info
- **GIVEN** a code judge is running with judge proxy access
- **WHEN** the script calls the `/info` endpoint via `judge.getInfo()`
- **THEN** the proxy returns JSON with `targetName`, `maxCalls`, and `callCount`
- **AND** the response includes the name of the configured judge target

#### Scenario: Info endpoint requires authentication
- **GIVEN** the judge proxy is running
- **WHEN** a request to `/info` is made without valid bearer token
- **THEN** the proxy responds with HTTP 401

### Requirement: Judge Proxy Target Override
The judge proxy SHALL allow code judges to specify an alternative target for individual invoke calls.

#### Scenario: Code judge overrides target for specific call
- **GIVEN** a code judge is running with judge proxy access
- **AND** multiple targets are configured in `agentv.config.yaml`
- **WHEN** the script calls `judge.invoke({ question: "...", target: "gpt-4o-mini" })`
- **THEN** the proxy routes the request to the specified target
- **AND** the call counts toward the `max_calls` limit

#### Scenario: Code judge uses default target when not specified
- **GIVEN** a code judge is running with judge proxy access
- **WHEN** the script calls `judge.invoke({ question: "..." })` without a `target` parameter
- **THEN** the proxy uses the default judge target (from `judge_target` or main target)

#### Scenario: Code judge specifies unknown target
- **GIVEN** a code judge is running with judge proxy access
- **WHEN** the script calls `judge.invoke({ question: "...", target: "nonexistent" })`
- **THEN** the proxy responds with HTTP 400 and an error message listing available targets

### Requirement: SDK Judge Proxy Capabilities
The `@agentv/eval` SDK SHALL expose judge proxy info and target override capabilities.

#### Scenario: SDK provides getInfo method
- **GIVEN** a code judge imports `createJudgeProxyClient` from `@agentv/eval`
- **WHEN** the script calls `judge.getInfo()`
- **THEN** it returns a typed object with `targetName`, `maxCalls`, `callCount`, and `availableTargets`

#### Scenario: SDK invoke accepts optional target parameter
- **GIVEN** a code judge creates a judge proxy client
- **WHEN** calling `judge.invoke({ question, target })`
- **THEN** the `target` parameter is included in the request to the proxy
