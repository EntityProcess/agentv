# Trajectory Assertions - Advanced

Demonstrates Promptfoo-compatible trajectory assertions combined with expected output validation.

## What This Shows

- Static trace file evaluation (pre-recorded traces)
- Trajectory assertion validation with full conversation structure
- `expected_output` for comprehensive validation
- Production-style multi-turn agent workflows
- Input/output validation for tool calls

## Running

```bash
# From repository root
cd examples/features
bun agentv eval trajectory-assertions-advanced/evals/trace-file-demo.eval.yaml --target static_trace
```

## Setup

Create `.env` in `examples/features/`:

```env
TRAJECTORY_ASSERTIONS_DIR=/absolute/path/to/examples/features/trajectory-assertions-advanced
```

## Key Files

- `cat-trace.ts` - CLI that reads static trace files
- `static-trace.json` - Pre-captured trace data
- `evals/trace-file-demo.eval.yaml` - Test cases with expected_output validation
