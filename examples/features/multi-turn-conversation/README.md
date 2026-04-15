# Multi-Turn Conversation Evaluation

Demonstrates evaluating multi-turn conversation quality using composable
`llm-grader` prompt templates with per-turn score breakdowns.

## What this shows

1. Multi-turn input with 4+ user/assistant turns where context retention matters
2. Conversation-aware grader prompts that receive the full `{{ input }}` message array
3. Per-turn score breakdown via structured `details`
4. Composability: multiple `llm-grader` graders combined with deterministic assertions

## Grader dimensions

| Grader | What it evaluates |
|-------|-------------------|
| `context-retention.md` | Does the agent remember information from earlier turns? |
| `conversation-relevancy.md` | Are responses relevant to the current request and conversation? |
| `role-adherence.md` | Does the agent maintain its assigned persona? |

## Running

```bash
bun apps/cli/src/cli.ts eval examples/features/multi-turn-conversation/evals/dataset.eval.yaml
```

## Creating your own conversation grader

1. Create a markdown file in `graders/`
2. Use `{{ input }}` to receive the full conversation message array with roles
3. Use `{{ criteria }}` for the test-specific evaluation criteria
4. Instruct the grader to return `details` with per-turn metrics when useful
5. Reference it in your YAML with `type: llm-grader` and `prompt: ./graders/your-grader.md`
