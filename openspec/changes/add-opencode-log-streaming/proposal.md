# Change: Add OpenCode provider support (with stream log artifacts)

## Why
AgentV currently supports agentic providers that operate over a filesystem and emit tool calls (e.g. Codex, Pi coding agent, VS Code subagent). OpenCode is another popular agent runtime with a well-defined event model (SSE) and structured tool lifecycle.

To evaluate agentic behavior (especially with deterministic evaluators like `tool_trajectory`) AgentV needs:
- A first-class `opencode` provider kind that can run OpenCode in an isolated per-eval workspace.
- A stable mapping from OpenCode tool parts into AgentV `outputMessages/toolCalls`.
- Debug visibility during execution, ideally via per-run stream logs that the CLI can surface early (Codex/Pi pattern).

## What Changes
- Add a new provider kind: `opencode`.
- Define required/optional target configuration for OpenCode in `targets.yaml`.
- Define how the OpenCode provider constructs prompts (system + parts) and executes within a per-eval-case work directory.
- Define the mapping from OpenCode message parts (especially `tool` parts) into AgentV `ProviderResponse.outputMessages` and `ToolCall` fields.
- Add a standard mechanism for an OpenCode provider to write per-run “stream logs” to disk (under `.agentv/logs/opencode/` by default).
- Add a lightweight “log tracker” so the `agentv eval` CLI can surface OpenCode log file paths immediately (same pattern as Codex/Pi).
- Define the expected log content at a high level (raw event JSONL is the default) so tooling remains stable even if OpenCode’s internal event structure evolves.

## Non-Goals
- Rich streaming UX in the AgentV terminal (token-by-token output).
- OpenCode TUI integration.
- Advanced OpenCode orchestration features beyond single-request evaluation (e.g., long-lived interactive sessions shared across evalcases).
- New CLI flags or UI features beyond listing log file paths.

## Impact
- Affected specs:
  - `evaluation` (OpenCode provider behavior, output mapping, and logging expectations)
  - `validation` (targets schema updates for `provider: opencode`)
  - `eval-cli` (CLI surfacing of provider log file paths)
- Affected code (planned follow-up implementation):
  - Core: OpenCode provider implementation, target schema updates, log tracker + exports
  - CLI: subscribe and display OpenCode log paths

## Compatibility
- Non-breaking. Existing targets and providers are unaffected.
- Logging remains optional (providers may omit log streaming when disabled or when directories cannot be created).

