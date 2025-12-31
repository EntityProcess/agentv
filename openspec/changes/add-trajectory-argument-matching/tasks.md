## 1. Implementation

- [ ] 1.1 Extend `ToolTrajectoryExpectedItem` type to include optional `args` field
- [ ] 1.2 Implement exact argument matching (deep equality)
- [ ] 1.3 Implement `any` mode (skip argument validation)
- [ ] 1.4 Update `evaluateInOrder` to check arguments
- [ ] 1.5 Update `evaluateExact` to check arguments
- [ ] 1.6 Update `extractToolCallsFromMessages` to preserve `ToolCall.input`

## 2. Schema & Validation

- [ ] 2.1 Update YAML schema for `expected[].args` field

## 3. Examples & Documentation

- [x] 3.1 Add argument matching examples to `examples/features/evals/tool-trajectory/tool-trajectory-demo.yaml`

## 4. Testing

- [ ] 4.1 Unit tests for exact argument matching
- [ ] 4.2 Unit tests for `any` mode
- [ ] 4.3 Integration tests with mock agent
