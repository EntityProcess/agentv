## 1. Schema & Parsing

- [x] 1.1 Update evaluator schema so `code_judge.script` is `string[]` (argv)
- [x] 1.2 Convert string `code_judge.script` to shell argv for backward compatibility
- [x] 1.3 Update YAML parser docs/specs for `code_judge`

## 2. Execution

- [x] 2.1 Add an argv-based subprocess helper (`execFileWithStdin` or equivalent)
- [x] 2.2 Execute `code_judge` via argv spawning (no shell)
- [x] 2.3 Keep stdin JSON payload contract unchanged
- [x] 2.4 Capture stdout/stderr in-memory (no temp files)
- [x] 2.5 Add timeout handling (kill/abort) for hung scripts
- [x] 2.6 Ensure cross-platform behavior (Windows/macOS/Linux)

## 3. Repository Updates

- [x] 3.1 Update all examples using `code_judge.script` to argv form
- [x] 3.2 Update any docs referencing string scripts

## 4. Tests

- [x] 4.1 Add/adjust unit tests for evaluator parsing validation errors
- [x] 4.2 Add/adjust execution tests for argv spawning
- [x] 4.3 Test stderr capture + non-zero exit surfaced to user
- [x] 4.4 Test large stdin payload (>1MB) round-trip
- [x] 4.5 Test timeout kill behavior
