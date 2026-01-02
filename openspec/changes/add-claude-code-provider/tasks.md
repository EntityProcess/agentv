## 1. Provider Implementation

- [x] 1.1 Create `packages/core/src/evaluation/providers/claude-code.ts`
  - Implement `ClaudeCodeProvider` class with `Provider` interface
  - Handle executable resolution (similar to Codex provider)
  - Build CLI arguments with `--output-format stream-json --verbose -p`
  - Support model, system prompt, cwd, timeout, and custom args
  - Parse JSONL streaming output

- [x] 1.2 Create `packages/core/src/evaluation/providers/claude-code-log-tracker.ts`
  - Implement log entry tracking similar to `codex-log-tracker.ts`
  - Support `consumeClaudeCodeLogEntries` and `subscribeToClaudeCodeLogEntries`

- [x] 1.3 Implement JSONL output parsing in `claude-code.ts`
  - Parse `system` init message for metadata
  - Parse `assistant` messages for tool calls and content
  - Parse `result` message for final answer and usage metrics
  - Extract `outputMessages` in AgentV format from Claude message stream

- [x] 1.4 Implement stream logging in `claude-code.ts`
  - Create `ClaudeCodeStreamLogger` class
  - Write timestamped logs to `.agentv/logs/claude-code/`
  - Support `AGENTV_CLAUDE_CODE_STREAM_LOGS` environment variable

## 2. Target Configuration

- [x] 2.1 Add `ClaudeCodeResolvedConfig` interface in `targets.ts`
  - Define fields: `executable`, `model`, `systemPrompt`, `args`, `cwd`, `timeoutMs`, `logDir`, `logFormat`

- [x] 2.2 Add `claude-code` case to `ResolvedTarget` union in `targets.ts`

- [x] 2.3 Implement `resolveClaudeCodeConfig` function in `targets.ts`
  - Handle snake_case/camelCase normalization
  - Support environment variable resolution with `${{ VAR }}` syntax
  - Default executable to `claude`

- [x] 2.4 Add `claude-code` case to `resolveTargetDefinition` switch in `targets.ts`

## 3. Provider Registration

- [x] 3.1 Add `'claude-code'` to `ProviderKind` type in `types.ts`

- [x] 3.2 Import and export `ClaudeCodeProvider` in `index.ts`

- [x] 3.3 Add `claude-code` case to `createProvider` switch in `index.ts`

- [x] 3.4 Export `ClaudeCodeResolvedConfig` type from `index.ts`

- [x] 3.5 Export log tracker functions from `index.ts`

## 4. Testing

- [x] 4.1 Create `packages/core/test/evaluation/providers/claude-code.test.ts`
  - Test JSONL output parsing for various message types
  - Test error handling for timeouts and non-zero exit codes
  - Test argument building with model, system prompt, and custom args
  - Test `outputMessages` extraction from Claude message stream

- [x] 4.2 Add integration test with mock Claude CLI
  - Verify end-to-end provider invocation
  - Test log file creation and content

## 5. Validation

- [x] 5.1 Run `bun run build` - verify compilation
- [x] 5.2 Run `bun run typecheck` - verify type safety
- [x] 5.3 Run `bun run lint` - verify code style
- [x] 5.4 Run `bun test` - verify all tests pass
