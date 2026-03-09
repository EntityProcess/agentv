# Multi-Turn Conversation Evaluation

Demonstrates evaluating multi-turn conversation quality using composable
`llm-judge` prompt templates with per-turn score breakdowns.

## What this shows

1. **Multi-turn input** — conversations with 4+ user/assistant turns where
   context retention matters
2. **Conversation-aware judge prompts** — markdown templates that receive the
   full `{{output}}` Message[] array and evaluate conversation-level qualities
3. **Per-turn score breakdown** — judges return structured `details` with
   per-turn scores, not just a flat conversation score
4. **Composability** — multiple llm-judge evaluators combined with
   deterministic assertions (e.g., `contains`)

## Judge dimensions

| Judge | What it evaluates |
|-------|-------------------|
| `context-retention.md` | Does the agent remember information from earlier turns? |
| `conversation-relevancy.md` | Are responses relevant to the current request and conversation? |
| `role-adherence.md` | Does the agent maintain its assigned persona? |

## Running

```bash
agentv run default --filter multi-turn-conversation
```

## Creating your own conversation evaluator

1. Create a markdown file in `judges/`
2. Use `{{ output }}` to receive the full conversation Message[] array
3. Use `{{ criteria }}` for the test-specific evaluation criteria
4. Instruct the judge to return `details` with per-turn metrics
5. Reference it in your YAML: `type: llm-judge` / `prompt: ./judges/your-judge.md`
