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

- The system spawns the process directly using argv tokens (no shell).
- The system writes a single JSON payload to stdin (unchanged contract).
- The system captures stdout and parses the JSON result as today.

### Migration

- Since this is breaking, existing string `script` values are rejected with a validation error.
- Update all repository examples to argv form as part of the same change.

## Non-Goals

- File-based evaluator input payload (could be added later if needed)
- Supporting both string and argv forms simultaneously

