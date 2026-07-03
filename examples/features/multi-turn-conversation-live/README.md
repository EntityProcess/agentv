# Multi-Turn Conversation (Live)

This example demonstrates **live turn-by-turn conversation evaluation** where the LLM generates each assistant response (unlike `multi-turn-conversation/` which scripts intermediate turns).

## Features Shown

- `mode: conversation` — enables live turn-by-turn evaluation
- `turns[]` — each entry is a user message that generates an LLM call
- Per-turn `assert` — string shorthand (rubric) and structured graders
- `aggregation: mean | min | max` — how turn scores combine
- `on_turn_failure: stop | continue` — behavior on assertion failure
- Top-level `assert` — conversation-level grading after all turns

## Running

```bash
# With default target
bun apps/cli/src/cli.ts eval examples/features/multi-turn-conversation-live/evals/suite.yaml

# With specific test
bun apps/cli/src/cli.ts eval examples/features/multi-turn-conversation-live/evals/suite.yaml --test-id context-retention
```
