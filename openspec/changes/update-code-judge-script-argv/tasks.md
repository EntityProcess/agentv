## 1. Schema & Parsing

- [ ] 1.1 Update evaluator schema so `code_judge.script` is `string[]` (argv)
- [ ] 1.2 Reject string `code_judge.script` with a clear error message
- [ ] 1.3 Update YAML parser docs/specs for `code_judge`

## 2. Execution

- [ ] 2.1 Execute `code_judge` via argv spawning (no shell)
- [ ] 2.2 Keep stdin JSON payload contract unchanged
- [ ] 2.3 Ensure cross-platform behavior (Windows/macOS/Linux)

## 3. Repository Updates

- [ ] 3.1 Update all examples using `code_judge.script` to argv form
- [ ] 3.2 Update any docs referencing string scripts

## 4. Tests

- [ ] 4.1 Add/adjust unit tests for evaluator parsing validation errors
- [ ] 4.2 Add/adjust execution tests for argv spawning

