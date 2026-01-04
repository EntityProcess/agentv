## Overview

This change updates `code_judge` evaluator configuration to accept argv tokens rather than a shell command string.

## Design

### Configuration

`code_judge` evaluator entries use:

- `type: code_judge`
- `script: string[]` (argv tokens)
- optional `cwd`, `weight`, and other existing fields

Example:

```yaml
evaluators:
  - name: risk_assessment_quality
    type: code_judge
    script: ["bun", "run", "validate_risk_output.ts"]
```

### Execution

**Goals**: eliminate shell execution for argv-based configs and temp-file I/O while keeping the stdin/stdout JSON contract intact.

- The system spawns the process directly using argv tokens (no shell).
- The system writes a single JSON payload to stdin (unchanged contract).
- The system captures stdout/stderr in-memory and parses stdout as JSON.
- Backward compatibility: if a string script is provided, it is converted to a shell argv (`["sh","-lc", "..."]` or `["cmd.exe","/c","..."]`) before execution.

**Bun implementation notes**:

- Prefer `Bun.spawn(cmd, { stdin: Uint8Array, stdout: "pipe", stderr: "pipe" })` where stdin is a single `Uint8Array` payload. Bun supports `TypedArray | DataView` as `stdin` inputs. This avoids incremental `stdin: "pipe"` flushing semantics and avoids piping `ReadableStream` to `stdin`, which has known compatibility issues in Bun.
- Drain `stdout` and `stderr` concurrently to avoid pipe-buffer backpressure deadlocks (same class of issue described in Node’s child_process docs for pipes with limited capacity).
- Enforce timeouts via Bun’s `timeout`/`killSignal` options (or an AbortSignal) so hung scripts are terminated deterministically.

**Windows note**:

- `.cmd`/`.bat` are not directly executable without a shell; users should explicitly invoke `cmd.exe /c` (or PowerShell) in argv when needed. The default path remains “no shell” for safety and determinism.

### Migration

- Since this is breaking, existing string `script` values are rejected with a validation error.
- Update all repository examples to argv form as part of the same change.

## Non-Goals

- File-based evaluator input payload (could be added later if needed)
- Supporting both string and argv forms simultaneously
- Reintroducing temp-file based stdio capture as a fallback
