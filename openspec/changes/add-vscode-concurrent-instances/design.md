## Context
VS Code subagent dispatch uses the VS Code CLI and focuses a workspace before sending chat instructions. With multiple VS Code windows open, the chat command can attach to the wrong window if focus changes between the focus step and the CLI dispatch. This forces the CLI to cap VS Code workers at 1.

## Goals / Non-Goals
- Goals:
  - Enable safe parallel VS Code eval workers by routing each request to a deterministic VS Code instance.
  - Preserve current default behavior and remain non-breaking.
  - Keep configuration minimal and opt-in.
- Non-Goals:
  - Redesign subagent locking or workspace provisioning.
  - Change VS Code prompt structure or Copilot behavior.

## Decisions
- Decision: Introduce an opt-in `vscode_instance_mode: isolated` target setting.
  - When enabled, the provider launches and targets per-instance VS Code processes using unique `--user-data-dir` and `--extensions-dir` paths.
  - Default remains focus-based with a worker cap.
- Decision: Add `vscode_instance_root` (optional) to control where per-instance data directories are created; default under `.agentv/vscode/instances/<targetName>`.
- Decision: Add `vscode_instance_count` (optional) to control the size of the instance pool; default to the eval run max concurrency when available.
- Decision: Pass VS Code CLI arguments through subagent (new `vscodeArgs` option) instead of embedding them in `vscode_cmd` strings.

## Risks / Trade-offs
- Extra disk usage and startup time per isolated instance (extensions and user data).
- Requires a subagent version that supports forwarding VS Code CLI arguments; older versions will not work with isolation.
- OS-specific path/quoting behavior must be validated, especially on Windows.

## Migration Plan
- No migration required. Existing targets keep `vscode_instance_mode` unset and continue to run with a single worker.
- Users who want parallel VS Code evals set `vscode_instance_mode: isolated` and optionally `vscode_instance_root`.

## Open Questions
- Should the instance count be explicitly configurable, or always match resolved worker count?
- Should extensions be shared across instances (single extensions dir) to reduce startup time?
- Do we need additional CLI flags to override instance root on a per-run basis?
