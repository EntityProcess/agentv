## 1. Implementation

- [x] 1.1 Extend `ToolTrajectoryExpectedItem` type to include optional `args` field
- [x] 1.2 Implement exact argument matching (deep equality)
- [x] 1.3 Implement `any` mode (skip argument validation)
- [x] 1.4 Update `evaluateInOrder` to check arguments
- [x] 1.5 Update `evaluateExact` to check arguments
- [x] 1.6 Update `extractToolCallsFromMessages` to preserve `ToolCall.input`

## 2. Schema & Validation

- [x] 2.1 Update YAML schema for `expected[].args` field (updated evaluator-parser.ts)

## 3. Examples & Documentation

- [x] 3.1 Add argument matching examples to `examples/features/evals/tool-trajectory/tool-trajectory-demo.yaml`

## 4. Testing

- [x] 4.1 Unit tests for exact argument matching
- [x] 4.2 Unit tests for `any` mode
- [x] 4.3 Integration tests with mock agent (covered by unit tests with mock context)
