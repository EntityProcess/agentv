# Beads

AgentV uses Beads for repo-local task tracking.

Use `br` for all Beads operations in this repository:

```bash
br ready --json
br list --json
br show <issue-id> --json
br update <issue-id> --claim --json
br close <issue-id> --reason "Completed" --json
br sync --flush-only
```

The durable task graph is tracked as JSONL in `.beads/issues.jsonl`. Local SQLite
databases, locks, history, and merge scratch files are ignored and should not be
committed.
