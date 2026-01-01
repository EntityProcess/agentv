## 1. Provider Implementation

- [ ] 1.1 Create `packages/core/src/evaluation/providers/claude.ts`
  - Implement `ClaudeProvider` class with `Provider` interface
  - Handle executable resolution (similar to Codex provider)
  - Build CLI arguments with `--output-format stream-json --verbose -p`
  - Support model, system prompt, cwd, timeout, and custom args
  - Parse JSONL streaming output

- [ ] 1.2 Create `packages/core/src/evaluation/providers/claude-log-tracker.ts`
  - Implement log entry tracking similar to `codex-log-tracker.ts`
  - Support `consumeClaudeLogEntries` and `subscribeToClaudeLogEntries`

- [ ] 1.3 Implement JSONL output parsing in `claude.ts`
  - Parse `system` init message for metadata
  - Parse `assistant` messages for tool calls and content
  - Parse `result` message for final answer and usage metrics
  - Extract `outputMessages` in AgentV format from Claude message stream

- [ ] 1.4 Implement stream logging in `claude.ts`
  - Create `ClaudeStreamLogger` class
  - Write timestamped logs to `.agentv/logs/claude/`
  - Support `AGENTV_CLAUDE_STREAM_LOGS` environment variable

## 2. Target Configuration

- [ ] 2.1 Add `ClaudeResolvedConfig` interface in `targets.ts`
  - Define fields: `executable`, `model`, `systemPrompt`, `args`, `cwd`, `timeoutMs`, `logDir`, `logFormat`

- [ ] 2.2 Add `claude` case to `ResolvedTarget` union in `targets.ts`

- [ ] 2.3 Implement `resolveClaudeConfig` function in `targets.ts`
  - Handle snake_case/camelCase normalization
  - Support environment variable resolution with `${{ VAR }}` syntax
  - Default executable to `claude`

- [ ] 2.4 Add `claude` case to `resolveTargetDefinition` switch in `targets.ts`

## 3. Provider Registration

- [ ] 3.1 Add `'claude'` to `ProviderKind` type in `types.ts`

- [ ] 3.2 Import and export `ClaudeProvider` in `index.ts`

- [ ] 3.3 Add `claude` case to `createProvider` switch in `index.ts`

- [ ] 3.4 Export `ClaudeResolvedConfig` type from `index.ts`

- [ ] 3.5 Export log tracker functions from `index.ts`

## 4. Testing

- [ ] 4.1 Create `packages/core/test/evaluation/providers/claude.test.ts`
  - Test JSONL output parsing for various message types
  - Test error handling for timeouts and non-zero exit codes
  - Test argument building with model, system prompt, and custom args
  - Test `outputMessages` extraction from Claude message stream

- [ ] 4.2 Add integration test with mock Claude CLI
  - Verify end-to-end provider invocation
  - Test log file creation and content

## 5. Validation

- [ ] 5.1 Run `bun run build` - verify compilation
- [ ] 5.2 Run `bun run typecheck` - verify type safety
- [ ] 5.3 Run `bun run lint` - verify code style
- [ ] 5.4 Run `bun test` - verify all tests pass
