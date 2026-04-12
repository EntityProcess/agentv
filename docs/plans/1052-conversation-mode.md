# Issue #1052: Multi-turn Conversational Test Case — Live Turn-by-Turn Evaluation

## Problem

Today, multi-turn evals script all intermediate assistant responses in `input` — the LLM only generates the last response. This means conversation context retention, progressive reasoning, and turn-by-turn quality cannot be measured independently.

## Solution

Add `mode: conversation` with a `turns` array that drives turn-by-turn LLM evaluation with per-turn and conversation-level grading.

### New Schema Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `'conversation'` | - | Enables conversation evaluation mode |
| `turns` | `ConversationTurn[]` | - | Ordered user messages; each generates an LLM call |
| `aggregation` | `'mean' \| 'min' \| 'max'` | `'mean'` | How turn scores combine into final score |
| `on_turn_failure` | `'continue' \| 'stop'` | `'continue'` | What to do when a turn's assertions fail |
| `window_size` | `number` | all turns | Sliding window for context passed to graders |

### How It Works

1. `input` provides system prompt and initial context (same as today)
2. For each entry in `turns`:
   a. Append the user message to accumulated history
   b. Call the provider with full history — LLM generates assistant response
   c. Grade the response against turn's `assertions` and `expected_output`
   d. Append actual LLM response (not expected_output) to history
3. After all turns: run top-level `assertions` over full transcript
4. Final score = aggregation of per-turn + conversation assertion scores

### Validation Rules

- `turns` requires `mode: conversation`
- `mode: conversation` requires `turns`
- `turns` incompatible with top-level `expected_output`
- `aggregation` only valid with `mode: conversation`
- Each turn must have non-empty `input`

### Files Modified

| File | Change |
|------|--------|
| `packages/core/src/evaluation/types.ts` | ConversationTurn, mode, turns, etc. on EvalTest |
| `packages/core/src/evaluation/validation/eval-file.schema.ts` | Zod schema for new fields |
| `packages/core/src/evaluation/yaml-parser.ts` | Parse conversation fields |
| `packages/core/src/evaluation/orchestrator.ts` | Conversation runner in runEvalCase |
| `packages/core/test/evaluation/conversation-mode.test.ts` | Unit tests |
| `examples/features/multi-turn-conversation-live/` | UAT example |

## References

- Issue: #1052
- Research: agentevals-research PR #57
- Prior art: #505 / PR #507 (scripted multi-turn), #331 / PR #1051 (depends_on)
