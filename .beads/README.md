# Beads

AgentV uses Beads for repo-local task tracking.

Use the original Beads CLI (`bd`, installed here as `beads`) for Beads operations in this repository:

```bash
bd ready --json
bd list --json
bd show <issue-id> --json
bd update <issue-id> --claim --json
bd close <issue-id> --reason "Completed" --json
bd export -o .beads/issues.jsonl
```

The durable task graph is tracked as JSONL in `.beads/issues.jsonl`. Local database
files, locks, history, and merge scratch files are ignored and should not be
committed.
