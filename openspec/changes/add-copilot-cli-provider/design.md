## Context

AgentV supports multiple provider kinds:
- Cloud LLM providers (Azure OpenAI, Anthropic, Gemini)
- Agent-style providers that operate on a workspace (Codex CLI, VS Code Copilot, Claude Code, Pi)

GitHub Copilot provides a CLI package (`@github/copilot`) that can be invoked via `npx` and interacted with through stdin/stdout. AgentV can adopt this pattern for evaluation runs.

## Goals
- Add a built-in provider kind that runs GitHub Copilot CLI (`@github/copilot`) as an external process.
- Keep configuration minimal and consistent with existing CLI-style providers (especially `codex`).
- Ensure deterministic capture of the “candidate answer” with good error messages and artifacts.

## Proposed Provider Identity
- Canonical kind: `copilot-cli`
- Accepted aliases (to reduce user friction): `copilot`, `github-copilot`

Rationale: `copilot` alone is ambiguous with the VS Code Copilot provider; `copilot-cli` makes intent explicit.

## Invocation Strategy

### Base command
Default to invoking Copilot via npm:
- `npx -y @github/copilot@<pinnedVersion>`

Rationale:
- Avoid requiring a global install.
- Match vibe-kanban’s approach.
- Pin a version to reduce behavior drift across runs.

### Process I/O
- Write the rendered prompt to stdin, then close stdin.
- Capture stdout/stderr.

### Log directory
- Pass `--log-dir <path>` and `--log-level debug` when supported.
- Record the log directory path in the ProviderResponse metadata for debugging.

### Timeout & cancellation
- Support a target-configured timeout (seconds or ms consistent with AgentV conventions).
- Abort via `AbortSignal` if provided by the orchestrator.

## Prompt Construction
Copilot CLI runs in a workspace directory, so the provider should follow the same “agent provider preread” pattern used by `vscode` and `codex`:
- Include a preread section that links guideline and attachment files via `file://` URLs.
- Include the user query.

## Response Extraction
Copilot CLI’s stdout is expected to contain a mixture of progress text and the final assistant message.

Proposed minimal extraction algorithm:
- Strip ANSI escape sequences.
- Trim surrounding whitespace.
- Treat the remaining stdout content as the candidate answer.
- Preserve full stdout/stderr as artifacts on failures.

If Copilot CLI later provides a stable, documented structured output mode, AgentV MAY add opt-in support in a future change.

## Target Configuration Surface
Keep this comparable to `codex`:
- `provider: copilot-cli`
- `settings.executable` (optional): defaults to `npx`
- `settings.args` (optional): appended args; default includes `-y @github/copilot@<version>` and flags
- `settings.cwd` (optional)
- `settings.timeoutSeconds` (optional)
- `settings.env` (optional)
- `settings.model` (optional)

Avoid overfitting to every Copilot CLI flag initially; allow passthrough args for advanced use.

## Security & Safety Notes
- Like other agent providers, Copilot CLI can read local files from the workspace.
- Any “allow all tools” behavior (if exposed) should be opt-in and clearly documented.
- Prefer defaulting to safer settings, consistent with existing providers.

## Testing Strategy (implementation stage)
- Unit tests for:
  - command argument construction
  - stdout parsing/extraction
  - timeout handling
- Integration-style tests (mock runner) that simulate Copilot CLI stdout/stderr.

## Alternatives Considered
- Use `gh copilot`:
  - Rejected: requested explicitly to use `@github/copilot` like vibe-kanban.
- Implement as `cli` provider template:
  - Rejected: would push complexity to users and lose built-in prompt construction and artifacts.
