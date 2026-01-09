# Change: Add OpenCode log streaming artifacts (Codex-style)

## Why
When evaluating agentic providers, users need visibility into what the agent is doing while the run is in-progress. AgentV currently exposes this for some agent CLIs (e.g. Codex/Pi) by writing a per-run log file and printing its path, but OpenCode support has no equivalent yet.

## What Changes
- Add a standard mechanism for an OpenCode provider to write per-run “stream logs” to disk (under `.agentv/logs/opencode/` by default).
- Add a lightweight “log tracker” so the `agentv eval` CLI can surface OpenCode log file paths immediately (same pattern as Codex/Pi).
- Define the expected log content at a high level (raw event JSONL or summarized lines) so tooling remains stable even if OpenCode’s internal event structure evolves.

## Non-Goals
- Implement full OpenCode provider execution in this change (this proposal only establishes logging + CLI surfacing conventions).
- Add new CLI flags or UI features beyond listing log file paths.

## Impact
- Affected specs:
  - `evaluation` (provider integration expectations for OpenCode logging)
  - `eval-cli` (CLI surfacing of provider log file paths)
- Affected code (planned follow-up implementation):
  - Core: provider log tracker + exports
  - CLI: subscribe and display OpenCode log paths

## Compatibility
- Non-breaking. Existing targets and providers are unaffected.
- Logging remains optional (providers may omit log streaming when disabled or when directories cannot be created).
