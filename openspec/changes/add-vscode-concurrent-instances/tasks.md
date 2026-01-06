## 1. Implementation
- [ ] 1.1 Extend VS Code target schema to accept `vscode_instance_mode`, `vscode_instance_root` (optional), and `vscode_instance_count` (optional) and resolve env vars
- [ ] 1.2 Update VS Code provider to derive per-instance CLI args (`--user-data-dir`, `--extensions-dir`) and pin requests to an instance when isolation is enabled
- [ ] 1.3 Update CLI worker resolution to allow >1 workers for VS Code targets when isolation is enabled and to provision matching subagents
- [ ] 1.4 Add/adjust unit tests for VS Code worker limits and new isolation settings
- [ ] 1.5 Update template docs in `apps/cli/src/templates/.claude/skills/agentv-eval-builder/` to document isolation mode

## 2. Dependencies
- [ ] 2.1 Update subagent integration to accept VS Code CLI arguments for deterministic instance targeting

## 3. Verification
- [ ] 3.1 Run `bun run build`
- [ ] 3.2 Run `bun run typecheck`
- [ ] 3.3 Run `bun run lint`
- [ ] 3.4 Run `bun test`
