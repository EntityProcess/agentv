## Context
AgentV currently supports several “agentic” providers (e.g. Codex, Pi coding agent, VS Code subagent) that can execute multi-step work with tool calls.

OpenCode is an agent runtime that exposes a local HTTP API plus Server-Sent Events (SSE) for streaming events. It also has a first-party TypeScript SDK (`@opencode-ai/sdk`) that can spawn a local `opencode serve` process and provides typed client methods.

This change expands the existing OpenSpec proposal from “OpenCode stream logs” to a full OpenCode provider integration for AgentV.

## Goals / Non-Goals

Goals:
- Add a new AgentV provider kind: `opencode`.
- Support running OpenCode against a per-eval-case working directory (AgentV temp workspace) so the agent can read/write files.
- Produce a `ProviderResponse.outputMessages` trace that captures:
  - The final assistant message text.
  - Tool calls (name + input + output) in a deterministic shape suitable for trace-based evaluators like `tool_trajectory`.
- Provide optional per-run streaming log artifacts on disk and publish log paths so the CLI can show them early (Codex/Pi pattern).

Non-Goals:
- Full UI/interactive experiences (OpenCode TUI, rich streaming token output in AgentV terminal).
- Implementing every OpenCode event type as a first-class AgentV trace event.
- Distributed / remote OpenCode deployments that require auth beyond local process execution.

## Key Decisions

- **Use OpenCode’s first-party SDK v2** (`@opencode-ai/sdk/v2`) rather than implementing a custom HTTP + SSE client.
  - Rationale: typed API surface, server lifecycle helper, fewer protocol footguns.

- **Primary completion signal:** use `client.session.prompt(...)` to run the request and treat its response as authoritative for the final assistant message and parts.
  - Streaming SSE is used for logs and (optionally) richer incremental trace capture.

- **Working directory isolation:** execute each eval case attempt in its own filesystem directory (AgentV temp workspace). The OpenCode client MUST include the directory context so OpenCode operates within that directory.
  - Rationale: reproducibility, parallelism, and preventing cross-contamination between eval cases.

## Provider Lifecycle

### Initialization
- Resolve target settings (binary/executable path, server config, model selection, permissions behavior, logging options).
- Start a local OpenCode server if no `baseUrl` is configured.
  - Prefer a per-process server instance (shared by provider invocations) to reduce spawn overhead.
  - The provider MUST avoid port collisions under parallel workers (either choose an ephemeral port, or allocate from a safe range).

### Per-eval invocation
For each `ProviderRequest`:
1. Create/resolve the eval-case work directory (temp workspace).
2. Create or reuse an OpenCode `sessionID` scoped to that directory.
3. If streaming logs enabled, open the stream log file and subscribe to `client.event.subscribe({ directory })` and write JSONL.
4. Send the prompt using `client.session.prompt({ sessionID, directory, system, parts, model?, agent?, tools? })`.
5. Build `ProviderResponse` from the returned `parts` (and optionally from gathered SSE events).
6. Tear down the SSE subscription for this invocation; keep the server alive for other requests.

### Shutdown
- Ensure spawned server processes are terminated on completion or abort.

## Prompt & Message Mapping

### Inputs
AgentV provides:
- `question` (formatted question string)
- optional `systemPrompt`
- optional `guidelines` (unwrapped content for non-agent providers)
- optional `guideline_files` / `input_files` (paths, often represented as `file://` links for agent providers)
- optional `chatPrompt` (multi-message)

Mapping approach:
- Prefer using `chatPrompt` when present.
  - Convert AgentV roles into OpenCode `system` + `parts`.
  - Include the final user query as a `text` part.
- For filesystem-capable agent providers (including OpenCode), prefer referencing guideline and attachment files as file links rather than embedding large inline content.

### Outputs
OpenCode returns an assistant message with `parts` including:
- `text` (assistant text)
- `reasoning` (optional)
- `tool` parts with `callID`, `tool`, and `state` (pending/running/completed/error)

AgentV output mapping:
- Construct a single final `OutputMessage` with:
  - `role: "assistant"`
  - `content: <concatenated assistant text parts>`
  - `toolCalls: ToolCall[]` derived from `tool` parts:
    - `id` = OpenCode `callID`
    - `tool` = OpenCode `tool`
    - `input` = `state.input` when present
    - `output` = `state.output` when present (for completed)

Optionally (future): emit separate `OutputMessage` entries for tool results, reasoning, or step boundaries. This is not required for initial tool-trajectory support.

## Streaming Logs

### Log content
- Default format: JSONL where each line is a single OpenCode SSE event object.
- MAY additionally include human-readable “summary” lines, but JSON objects MUST be preserved to keep tooling stable.

### Log path publication
- When the provider selects a log file path, it publishes `{ filePath, targetName, evalCaseId?, attempt? }` to a process-local tracker.

## Permissions

OpenCode can emit `permission.asked` events (e.g., filesystem writes, command execution).

Initial policy:
- Provide a target option to auto-approve permissions (`once` or `always`) or reject.
- Default SHOULD be conservative (reject) unless explicitly enabled.

## Risks / Trade-offs
- **Port management / concurrency:** shared server improves performance but requires careful port selection and isolation.
- **Trace fidelity:** relying on final `parts` is deterministic but may omit some intermediate streaming deltas.
- **Permission behavior:** auto-approval increases convenience but raises safety risk; default should remain restrictive.

## Migration Plan
- Non-breaking addition: new provider kind and target schema fields are additive.
- Existing targets remain valid.

## Open Questions
- Should AgentV support connecting to an externally-running OpenCode server (`baseUrl`) in addition to spawning a local server?
- Should OpenCode be treated as an `AGENT_PROVIDER_KIND` (filesystem access) by default?
- Which OpenCode “tools” should be enabled/disabled by default when running evals?
