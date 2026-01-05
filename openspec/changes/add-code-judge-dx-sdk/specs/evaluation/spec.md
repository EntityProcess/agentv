## REMOVED Requirements

### Requirement: Optional TypeScript SDK
**Reason**: Replaced by new declarative `defineCodeJudge` API with better DX
**Migration**: Use `defineCodeJudge()` from `@agentv/core/judge` instead of `readCodeJudgePayload()` from `@agentv/core`

## ADDED Requirements

### Requirement: Declarative Code Judge SDK
The system SHALL provide a declarative TypeScript SDK for code_judge evaluator authors via the `@agentv/core/judge` entrypoint.

#### Scenario: Define code judge with handler function
- **WHEN** a TypeScript code_judge evaluator imports `defineCodeJudge` from `@agentv/core/judge`
- **THEN** it can define the evaluator by calling `defineCodeJudge(handler)`
- **AND** the handler receives a typed `CodeJudgeInput` object with camelCase properties
- **AND** the handler returns a `CodeJudgeResult` object
- **AND** stdin parsing, error handling, and output formatting are handled automatically
- **IMPLEMENTATION**:
  - SDK exports: `defineCodeJudge()`, `CodeJudgeInput`, `CodeJudgeResult`
  - Location: `packages/core/src/judge/index.ts`

#### Scenario: Declarative SDK eliminates boilerplate
- **GIVEN** a code_judge evaluator using `defineCodeJudge`
- **WHEN** the evaluator is implemented
- **THEN** no `export {}` statement is required (default export pattern)
- **AND** no manual stdin reading or JSON parsing is required
- **AND** no try/catch error handling boilerplate is required
- **AND** no manual type definitions for `TraceSummary` or result types are required

#### Scenario: SDK validates output at runtime
- **WHEN** a code_judge handler returns a result
- **THEN** the SDK validates the result against `CodeJudgeResultSchema`
- **AND** clamps `score` to the range `[0.0, 1.0]`
- **AND** defaults `hits` and `misses` to empty arrays if not provided
- **AND** emits a valid JSON object to stdout

#### Scenario: SDK handles errors gracefully
- **WHEN** a code_judge handler throws an exception
- **THEN** the SDK catches the error and outputs a failure result
- **AND** the result has `score: 0`
- **AND** the result has `misses` containing the error message
- **AND** the result has `reasoning` explaining the failure
- **AND** the process exits with code 1

#### Scenario: SDK provides separate package entrypoint
- **WHEN** a code_judge evaluator imports from `@agentv/core/judge`
- **THEN** only judge-specific utilities are imported
- **AND** the package.json exports `./judge` as a separate entrypoint
- **IMPLEMENTATION**:
  - Package export: `"./judge": { "import": "./dist/judge/index.js", "types": "./dist/judge/index.d.ts" }`

#### Scenario: SDK re-exports canonical types
- **WHEN** a code_judge evaluator imports from `@agentv/core/judge`
- **THEN** it can import `TraceSummary`, `OutputMessage`, and other relevant types
- **AND** these types match the canonical definitions in `@agentv/core`

#### Scenario: SDK integration test
- **WHEN** tests run the evaluator test suite
- **THEN** an integration test verifies `defineCodeJudge`-based code judges work correctly
- **IMPLEMENTATION**:
  - Test: `packages/core/test/judge/define-code-judge.test.ts`
