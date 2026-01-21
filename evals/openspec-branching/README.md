# OpenSpec Branching Strategy Eval

Tests that AI agents follow the branching guidelines in `openspec/AGENTS.md`.

## Key Requirements

1. **Never work on main** - Always create `feat/<change-id>` branch first
2. **Open PR for review** - Proposals need review before implementation
3. **Approval gate** - Don't implement until proposal PR is approved

## Running

```bash
# Validate YAML
agentv validate examples/features/openspec-branching/evals/dataset.yaml

# Run with your agent target
agentv eval examples/features/openspec-branching/evals/dataset.yaml --target <agent>
```
