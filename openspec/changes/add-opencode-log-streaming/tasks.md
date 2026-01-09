## 1. Implementation
- [ ] 1.1 Add new provider kind `opencode` (core provider registry + aliases)
- [ ] 1.2 Extend targets schema to support `provider: opencode` and validate settings
- [ ] 1.3 Implement OpenCode provider invocation (server lifecycle, per-eval-case directory, prompt execution)
- [ ] 1.4 Map OpenCode `tool` parts into AgentV `outputMessages/toolCalls` for trace-based evaluators
- [ ] 1.5 Add OpenCode stream log writer (JSONL) and log path tracker (record/consume/subscribe)
- [ ] 1.6 Export OpenCode log tracker functions from provider index
- [ ] 1.7 Update `agentv eval` CLI to subscribe and print OpenCode log paths (no duplicates)

## 2. Validation
- [ ] 2.1 Run `openspec validate add-opencode-log-streaming --strict`
- [ ] 2.2 Add/update unit tests for:
	- [ ] targets schema parsing for `opencode` targets
	- [ ] tool-call mapping from OpenCode parts → AgentV `ToolCall`
	- [ ] log tracker dedupe behavior (CLI subscriber)

## 3. Documentation
- [ ] 3.1 Update any relevant skill/docs (if the project uses them for provider setup)
