# Copilot Transcript Replay Example

Demonstrates provider-agnostic recorded trajectory replay for a Copilot CLI
session. Copilot `events.jsonl` data is normalized into AgentV transcript JSONL,
then `provider: replay` runs deterministic graders without invoking Copilot
again. **No LLM API key needed for replay.**

Graders used:
- `not-skill-used` — checks whether a specific skill was avoided
- `script-grader` — custom TypeScript grader inspecting the full `Message[]` with tool calls

## Setup

### 1. Generate a Copilot session

Start a Copilot CLI session in the workspace directory:

```bash
cd workspace/
copilot --model gpt-5-mini -p "Analyze this CSV file and tell me the top 5 months by revenue"
```

Or interactively:

```bash
copilot --model gpt-5-mini
> Analyze this CSV file and tell me the top 5 months by revenue
```

Import the session into a normalized AgentV transcript:

```bash
agentv import copilot \
  --session-id <uuid> \
  --test-id should-not-trigger-csv-analyzer \
  --provider copilot-cli \
  -o fixtures/copilot-transcript.jsonl
```

The checked-in fixture already uses this normalized shape for deterministic
example runs.

### 2. Run the replay eval

```bash
agentv eval evals/skill-use.EVAL.yaml --provider copilot-transcript-replay
```

The `before_all` hook syncs the agentv-dev plugin skills into the workspace.
The replay target matches the eval case by `test_id`, reads the normalized
transcript rows from `fixtures/copilot-transcript.jsonl`, and runs all graders.

## How it works

```
allagents workspace init (setup hook)
  ↓ syncs agentv-dev plugin skills from marketplace
~/.copilot/session-state/{uuid}/events.jsonl
  ↓ agentv import copilot
AgentV transcript JSONL (agentv.transcript.v1)
  ↓ provider: replay with transcripts: fixtures/copilot-transcript.jsonl
Message[] with tool calls and raw source provenance
  ├─ not-skill-used grader (deterministic) → pass/fail
  └─ script-grader (graders/transcript-quality.ts) → pass/fail
```

## Graders

### not-skill-used
Checks whether the `csv-analyzer` skill was (or was not) invoked.
Inspects tool call names and skill invocation events in the transcript.

### transcript-quality (script-grader)
Custom grader using `defineScriptGrader` from `@agentv/sdk`. Validates:
1. Transcript contains assistant messages
2. Tool calls were recorded (inspects `Message[].toolCalls`)
3. Response addresses the CSV analysis question

## Workspace

Skills are sourced in two ways:
- **Bundled:** `csv-analyzer` in `.copilot/skills/` (example-specific)
- **Plugin:** agentv-dev skills synced via `allagents workspace init` from the
  `agentv` marketplace into `.github/skills/`
