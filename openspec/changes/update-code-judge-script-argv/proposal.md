# Change: Update `code_judge` `script` to argv form (breaking)

## Why

`code_judge` evaluators currently accept a single shell command string. This is brittle (quoting/escaping), less portable across platforms, and encourages shell execution (`sh -c` / `cmd.exe /c`). Moving to an argv form makes evaluator execution more deterministic, safer, and easier to author.

## What Changes

- **BREAKING**: `code_judge` evaluator `script` changes from `string` (shell command) to `string[]` (argv tokens).
- Execution uses direct process spawning (no shell) and passes the evaluator input payload via stdin as today.
- Update all repo examples to use argv form.

## Impact

- Affected specs: `yaml-schema`, `evaluation`
- Affected code: YAML evaluator parsing/validation, code_judge execution, examples under `examples/`
- Breaking change: existing eval YAML using `script: "bun run ..."` must be updated to `script: ["bun", "run", ...]`

