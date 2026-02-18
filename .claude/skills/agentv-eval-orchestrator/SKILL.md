---
name: agentv-eval-orchestrator
description: Run AgentV evaluations without API keys by orchestrating eval subcommands. Use this skill when asked to run evals, evaluate an agent, or test prompt quality using agentv.
---

# AgentV Eval Orchestrator

Run AgentV evaluations by acting as the LLM yourself — no API keys needed.

## Quick Overview

AgentV evals are split into discrete steps you orchestrate:

```
agentv eval input  → get task prompt → you answer it → agentv eval judge → get score
```

## Step-by-Step Workflow

### 1. Get the task input

```bash
agentv eval input <eval-file.yaml> --eval-id <case-id>
```

Returns JSON:
```json
{
  "eval_id": "case-1",
  "question": "...",           // Flat string prompt (use this for simple cases)
  "input_messages": [...],     // Structured chat messages (use for multi-turn)
  "guidelines": "...",         // Prepend to system message if non-null
  "system_message": "...",     // Explicit system message if present
  "expected_outcome": "...",   // What a good answer should do (for your reference)
  "file_paths": [...]          // Referenced files (already embedded in question)
}
```

**Which field to use:**
- For simple single-turn: read `question` as the user prompt
- For multi-turn or chat APIs: use `input_messages` array
- Always incorporate `guidelines` into context when non-null

### 2. Generate your answer

Use the prompt from step 1 to produce an answer. Save it to a file:

```bash
echo "Your answer here" > /tmp/answer.txt
```

### 3. Judge the answer

```bash
agentv eval judge <eval-file.yaml> --eval-id <case-id> --output-file /tmp/answer.txt
```

Returns JSON with an `evaluators` array:

```json
{
  "eval_id": "case-1",
  "evaluators": [
    {
      "name": "keyword_check",
      "type": "code_judge",
      "status": "completed",
      "result": { "score": 1.0, "hits": [...], "misses": [] }
    },
    {
      "name": "default_llm_judge",
      "type": "llm_judge",
      "status": "prompt_ready",
      "prompt": { "system_prompt": "...", "user_prompt": "..." }
    }
  ]
}
```

**Handle each evaluator by status:**

- **`"completed"`** — Score is final. Read `result.score` (0.0-1.0).
- **`"prompt_ready"`** — You must grade it yourself:
  1. Send `prompt.system_prompt` as system message and `prompt.user_prompt` as user message to your LLM
  2. The LLM response is a JSON object: `{"score": 0.85, "hits": [...], "misses": [...], "reasoning": "..."}`
  3. Use that `score` as the evaluator result

### 4. Discover all cases

```bash
agentv eval prompt <eval-file.yaml>
```

Lists all eval case IDs with their expected outcomes and the commands to run.

## Complete Example

```bash
# 1. See what cases exist
agentv eval prompt evals/dataset.yaml

# 2. Get input for a specific case
agentv eval input evals/dataset.yaml --eval-id greeting-test
# → read the "question" field from JSON output

# 3. Generate answer and save to file
echo "Hello! How can I help you today?" > /tmp/answer.txt

# 4. Judge the answer
agentv eval judge evals/dataset.yaml --eval-id greeting-test --output-file /tmp/answer.txt
# → check each evaluator's status in the JSON output
# → for "prompt_ready" evaluators, send the prompt to your LLM for grading
```

## Tips

- Use `--eval-id` with glob patterns in `agentv eval run` to filter: `--eval-id "summary-*"`
- All subcommands write data to **stdout** and warnings to **stderr** — safe to pipe
- If you have API keys, `agentv eval run` does everything in one command (no orchestration needed)
- The `eval judge` command runs code_judge scripts directly but only assembles prompts for llm_judge — you execute the LLM call
