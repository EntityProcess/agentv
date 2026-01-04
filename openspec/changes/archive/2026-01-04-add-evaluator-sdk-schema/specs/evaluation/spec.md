## ADDED Requirements
### Requirement: Canonical Code Judge Wire Schema
The system SHALL define a canonical code_judge payload schema with snake_case wire keys.

#### Scenario: Emit payload to code_judge evaluator
- **WHEN** the runtime invokes a code_judge evaluator
- **THEN** it emits a JSON payload that conforms to the canonical schema
- **AND** field names are snake_case in the wire format
- **IMPLEMENTATION**: `CodeEvaluator` uses `toSnakeCaseDeep()` to convert internal camelCase to snake_case JSON

#### Scenario: Preserve legacy payload shape
- **WHEN** existing code_judge evaluators read stdin payloads
- **THEN** the payload shape remains compatible with the current snake_case format
- **VERIFIED**: Existing Node.js code judges continue to work unchanged

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
