## 1. Implementation
- [ ] 1.1 Add `opencode-log-tracker` module (record/consume/subscribe)
- [ ] 1.2 Export OpenCode log tracker functions from provider index
- [ ] 1.3 Update `agentv eval` CLI to subscribe and print OpenCode log paths
- [ ] 1.4 Update progress display labels to include OpenCode
- [ ] 1.5 Wire OpenCode provider (future PR) to call `recordOpencodeLogEntry()` and write log lines

## 2. Validation
- [ ] 2.1 Run `openspec validate add-opencode-log-streaming --strict`
- [ ] 2.2 Add/update unit tests if new runtime logic is introduced

## 3. Documentation
- [ ] 3.1 Update any relevant skill/docs (if the project uses them for provider setup)
