# Change: Update `code_judge` `script` to argv form (breaking)

## Why

`code_judge` evaluators currently accept a single shell command string. This is brittle (quoting/escaping), less portable across platforms, and encourages shell execution (`sh -c` / `cmd.exe /c`). Moving to an argv form makes evaluator execution more deterministic, safer, and easier to author.

Additionally, the current `code_judge` execution path relies on shell redirection and temp files to pass stdin and capture stdout/stderr. While pragmatic, this adds filesystem complexity and preserves shell execution risks. This change replaces that with direct argv spawning and in-memory stdio handling.

## What Changes

- `code_judge` evaluator `script` uses `string[]` (argv tokens), while legacy string scripts are converted to shell argv for backward compatibility.
- Execution uses direct process spawning (no shell) and passes the evaluator input payload via stdin as today.
- Replace temp-file/stdout-stderr redirection with in-memory stdio capture.
- Update all repo examples to use argv form.

## Impact

- Affected specs: `yaml-schema`, `evaluation`
- Affected code: YAML evaluator parsing/validation, code_judge execution, examples under `examples/`
- Backward compatibility: existing eval YAML using `script: "bun run ..."` continues working via shell argv conversion (users should migrate to argv for determinism).

## Out of Scope / Non-Goals

- Supporting both string and argv `script` forms simultaneously.
- Reintroducing temp-file based execution as a fallback.
- Changing the stdin JSON payload contract or the JSON shape returned on stdout.
