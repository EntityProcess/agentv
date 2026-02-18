---
name: agentv-eval-orchestrator
description: Run AgentV evaluations without API keys by orchestrating eval subcommands. Use this skill when asked to run evals, evaluate an agent, or test prompt quality using agentv.
---

# AgentV Eval Orchestrator

Run AgentV evaluations by acting as the LLM yourself — no API keys needed.

## Quick Start

```bash
agentv eval prompt <eval-file.yaml>
```

This outputs a complete orchestration prompt with step-by-step instructions and all eval case IDs. Follow its instructions.

## Workflow

For each eval case, run these three steps:

### 1. Get Task Input

```bash
agentv eval prompt input <path> --eval-id <id>
```

Returns JSON with `question`, `guidelines`, `input_messages`, `expected_outcome`, and `file_paths`.

### 2. Execute the Task

You ARE the candidate LLM. Read the `question` field from step 1 and answer it directly. Save your response to a temp file:

```bash
# Write your answer to a file
cat > /tmp/eval_<id>.txt << 'ANSWER'
<your complete response here>
ANSWER
```

**Important**: Do not leak `expected_outcome` into your answer — it's for your reference when judging, not part of the task.

### 3. Judge the Result

```bash
agentv eval prompt judge <path> --eval-id <id> --answer-file /tmp/eval_<id>.txt
```

Returns JSON with an `evaluators` array. Each evaluator has a `status`:

- **`"completed"`** — Deterministic score is final. Read `result.score` (0.0–1.0).
- **`"prompt_ready"`** — LLM grading required. Send `prompt.system_prompt` as system and `prompt.user_prompt` as user to yourself. Parse the JSON response to get `score`, `hits`, `misses`.

## When to use this vs `agentv eval run`

- **`agentv eval run`** — You have API keys configured. Runs everything end-to-end automatically.
- **`agentv eval prompt`** — No API keys. You orchestrate: get input, answer the task yourself, judge the result.
