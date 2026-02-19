# AgentV Self-Evaluation

This folder contains evaluations to ensure AgentV's `AGENTS.md` design principles don't regress.

## Structure

```
evals/
├── targets.yaml              # Target definitions
├── design-principles.yaml    # Eval cases
└── design-principles-judge.md # LLM judge prompt
```

## Known Issue: pi-coding-agent on Windows

The pi-coding-agent provider has issues passing multi-line prompts on Windows. When running pi directly from CLI, it works correctly, but through the provider the prompt content is not received by pi.

**Workaround**: Use mock provider for testing eval structure, or run on macOS/Linux.

**To fix**: Investigate `packages/core/src/evaluation/providers/pi-coding-agent.ts` - specifically how `spawn()` handles arguments with newlines on Windows.

## Running the Evals

```bash
# Dry run to verify structure
bun agentv run evals/design-principles.yaml --targets evals/targets.yaml --dry-run

# Full run (requires working pi-coding-agent or alternative target)
bun agentv run evals/design-principles.yaml --targets evals/targets.yaml
```

## Test Cases

1. **violates-lightweight-core** - Proposes adding complex built-in (should fail)
2. **violates-ai-first-design** - Proposes rigid CLI instructions (should fail)
3. **follows-principles** - Proposes plugin/example approach (should pass)
