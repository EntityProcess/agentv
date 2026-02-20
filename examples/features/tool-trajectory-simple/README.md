# Tool Trajectory - Simple

Demonstrates tool trajectory evaluation with different matching modes.

## What This Shows

- `any_order` mode: Validate minimum tool call counts
- `in_order` mode: Validate tool sequence (allows gaps)
- `exact` mode: Validate exact tool sequence
- Argument matching and validation
- Mock agent that generates tool traces

## Running

```bash
# From repository root
cd examples/features
bun agentv eval tool-trajectory-simple/evals/dataset.yaml --target mock_agent
```

## Setup

Create `.env` in `examples/features/`:

```env
TOOL_TRAJECTORY_DIR=/absolute/path/to/examples/features/tool-trajectory-simple
```

## Key Files

- `mock-agent.ts` - Mock CLI agent that simulates tool usage
- `evals/dataset.yaml` - Test cases demonstrating different trajectory modes
