## MODIFIED Requirements

### Requirement: Optional TypeScript SDK
The system SHALL provide an optional, idiomatic TypeScript SDK for code_judge evaluator authors.

#### Scenario: TypeScript SDK usage
- **WHEN** a TypeScript code_judge evaluator imports from `@agentv/core`
- **THEN** it can use `readCodeJudgePayload()` to read stdin
- **AND** the returned object has camelCase properties (e.g., `candidateAnswer`, `expectedOutcome`)
- **AND** TypeScript types provide compile-time safety
- **IMPLEMENTATION**:
  - SDK exports: `CodeJudgePayload` interface, `readCodeJudgePayload()`, `parseCodeJudgePayload()`
  - Internally uses `toCamelCaseDeep()` to convert snake_case stdin to camelCase
  - Location: `packages/core/src/evaluation/code-judge-sdk.ts`

#### Scenario: SDK integration test
- **WHEN** tests run the evaluator test suite
- **THEN** an integration test verifies SDK-based code judges work correctly
- **AND** the test fixture uses `readCodeJudgePayload()` from the SDK
- **IMPLEMENTATION**:
  - Test: `packages/core/test/evaluation/evaluators.test.ts` ("works with TypeScript SDK-based code judge")
  - Fixture: `packages/core/test/fixtures/test-sdk-judge.ts`

#### Scenario: SDK feature example
- **WHEN** users explore `examples/features/code-judge-sdk/`
- **THEN** they find a working example that imports from `@agentv/core`
- **AND** the example runs out of the box after `bun install && bun run build`
- **AND** the README demonstrates standalone testing
- **IMPLEMENTATION**:
  - Example: `examples/features/code-judge-sdk/scripts/verify-attachments.ts`
  - Package: `examples/features/code-judge-sdk/package.json` (workspace dependency on `@agentv/core`)
  - Workspace: Root `package.json` includes `examples/features/*` and `examples/showcase/*`

#### Scenario: Declarative code judge definition
- **WHEN** a TypeScript code_judge evaluator imports from `@agentv/core/judge`
- **THEN** it can use `defineCodeJudge(handler)` to define the evaluator declaratively
- **AND** the handler receives a typed `CodeJudgeInput` object with camelCase properties
- **AND** the handler returns a `CodeJudgeResult` object that is validated at runtime
- **AND** stdin parsing, error handling, and output formatting are handled automatically
- **IMPLEMENTATION**:
  - SDK exports: `defineCodeJudge()`, `CodeJudgeInput`, `CodeJudgeResult`
  - Location: `packages/core/src/judge/index.ts`
  - Runtime: `packages/core/src/judge/runtime.ts`

#### Scenario: Declarative SDK reduces boilerplate
- **GIVEN** a code_judge evaluator using the declarative SDK
- **WHEN** the evaluator is implemented
- **THEN** no `export {}` statement is required (default export pattern)
- **AND** no manual stdin reading or JSON parsing is required
- **AND** no try/catch error handling boilerplate is required
- **AND** no manual type definitions for `TraceSummary` or `EvalOutput` are required

#### Scenario: Declarative SDK validates output
- **WHEN** a code_judge handler returns a result
- **THEN** the SDK validates the result against `CodeJudgeResultSchema`
- **AND** clamps `score` to the range `[0.0, 1.0]`
- **AND** defaults `hits` and `misses` to empty arrays if not provided
- **AND** emits a valid JSON object to stdout

#### Scenario: Declarative SDK handles errors
- **WHEN** a code_judge handler throws an exception
- **THEN** the SDK catches the error and outputs a failure result
- **AND** the result has `score: 0`
- **AND** the result has `misses` containing the error message
- **AND** the result has `reasoning` explaining the failure
- **AND** the process exits with code 1

#### Scenario: Declarative SDK separate entrypoint
- **WHEN** a code_judge evaluator imports from `@agentv/core/judge`
- **THEN** only judge-specific utilities are imported
- **AND** the package.json exports `./judge` as a separate entrypoint
- **IMPLEMENTATION**:
  - Package export: `"./judge": { "import": "./dist/judge/index.js", "types": "./dist/judge/index.d.ts" }`

#### Scenario: Declarative SDK re-exports types
- **WHEN** a code_judge evaluator imports from `@agentv/core/judge`
- **THEN** it can import `TraceSummary`, `OutputMessage`, and other relevant types
- **AND** these types match the canonical definitions in `@agentv/core`
