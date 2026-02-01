# Tool Trajectory - Advanced

Demonstrates tool trajectory evaluation combined with expected output validation.

## What This Shows

- Static trace file evaluation (pre-recorded traces)
- Tool trajectory validation with full conversation structure
- `expected_output` for comprehensive validation
- Production-style multi-turn agent workflows
- Input/output validation for tool calls

## Running

```bash
# From repository root
cd examples/features
bun agentv eval tool-trajectory-advanced/evals/trace-file-demo.yaml --target static_trace
```

## Setup

Create `.env` in `examples/features/`:

```env
TOOL_TRAJECTORY_DIR=/absolute/path/to/examples/features/tool-trajectory-advanced
```

## Key Files

- `cat-trace.ts` - CLI that reads static trace files
- `static-trace.json` - Pre-captured trace data
- `evals/trace-file-demo.yaml` - Test cases with expected_output validation
