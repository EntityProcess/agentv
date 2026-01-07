## 1. Provider + Targets
- [ ] 1.1 Add `copilot-cli` to `ProviderKind`, `KNOWN_PROVIDERS`, and `AGENT_PROVIDER_KINDS` (and decide aliases).
- [ ] 1.2 Extend target parsing to recognize `provider: copilot-cli` (and chosen aliases) and resolve a typed Copilot config.
- [ ] 1.3 Extend `targets-validator` to accept the Copilot settings keys and reject unknown properties with actionable errors.

## 2. Execution
- [ ] 2.1 Implement `CopilotCliProvider` (mirroring patterns from `CodexProvider`): spawn process, write prompt to stdin, capture stdout/stderr, enforce timeout.
- [ ] 2.2 Implement prompt preread rendering consistent with other agent providers (file:// links for guidelines and attachments).
- [ ] 2.3 Implement robust stdout parsing to extract a single candidate answer; preserve raw artifacts on errors.
- [ ] 2.4 Register provider in provider factory/registry.

## 3. Docs + Templates
- [ ] 3.1 Update CLI docs to list `copilot-cli` as a supported provider and add a minimal `targets.yaml` example.
- [ ] 3.2 Update `apps/cli/src/templates/.claude/skills/agentv-eval-builder/` references so `agentv init` users get Copilot CLI guidance.

## 4. Tests
- [ ] 4.1 Add unit tests for config resolution and argument rendering.
- [ ] 4.2 Add provider tests using a mocked runner (no real Copilot CLI dependency) for success, invalid output, and timeout.

## 5. Validation
- [ ] 5.1 Run `bun run build`, `bun run typecheck`, `bun run lint`, `bun test`.

## 6. Release hygiene
- [ ] 6.1 Add a changeset if user-visible behavior changes should ship in the next release.
