# Trajectory Assertions - Simple

Demonstrates Promptfoo-compatible trajectory assertions with different matching modes.

## What This Shows

- `trajectory:tool-used`: Validate minimum tool call counts
- `trajectory:tool-sequence` with `in_order`: Validate tool sequence while allowing gaps
- `trajectory:tool-sequence` with `exact`: Validate exact tool sequence
- Argument matching and validation
- Mock agent that generates tool traces

## Running

```bash
# From repository root
cd examples/features
bun agentv eval trajectory-assertions-simple/evals/suite.yaml --provider mock_agent
```

## Setup

Create `.env` in `examples/features/`:

```env
TRAJECTORY_ASSERTIONS_DIR=/absolute/path/to/examples/features/trajectory-assertions-simple
```

## Key Files

- `mock-agent.ts` - Mock CLI agent that simulates tool usage
- `evals/suite.yaml` - Test cases demonstrating different trajectory modes
