## Context
AgentV supports provider batching in the orchestrator, and we are adding/supporting JSONL batch output for the CLI provider. Without a batch input contract, a CLI command must source evalcases from somewhere else (e.g., a parallel CSV), which creates dataset drift.

## Goals
- Provide an explicit, machine-readable batch input bundle to CLI commands during `cli` batching.
- Preserve simple per-case placeholder rendering for non-batched `invoke()`.

## Decisions
- The bundle MUST include `id` matching evalcase ids so output JSONL can be joined reliably.
- The bundle format should be a single JSON file (not YAML) for simplicity and speed.

## Bundle schema (draft)
```json
{
  "version": 1,
  "evalcases": [
    {
      "id": "case-1",
      "input_messages": [{"role": "user", "content": "..."}],
      "guidelines": "...",
      "files": ["/abs/path/a.md"]
    }
  ]
}
```

## Open questions
- Placeholder choice: new `{BATCH_FILE}` vs reusing `{PROMPT}` in batch mode.
- Cleanup: should the bundle be deleted after command completes (default yes).
