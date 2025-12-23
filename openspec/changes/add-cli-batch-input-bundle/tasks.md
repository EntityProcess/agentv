## 1. Implementation
- [ ] 1.1 Decide how the batch bundle path is surfaced to `commandTemplate`:
  - [ ] Option A: Introduce a new placeholder (e.g., `{BATCH_FILE}`)
  - [ ] Option B: Reuse `{PROMPT}` to carry the bundle file path in batch mode
- [ ] 1.2 Implement writing a bundle file during `CliProvider.invokeBatch`.
- [ ] 1.3 Define a stable bundle schema (JSON) including:
  - [ ] evalcase id
  - [ ] input_messages
  - [ ] guidelines
  - [ ] attached files list
- [ ] 1.4 Update CLI placeholder validation to allow the chosen placeholder.
- [ ] 1.5 Add tests:
  - [ ] verify bundle file is written and passed to the runner
  - [ ] verify bundle includes all evalcases and ids
  - [ ] verify cleanup of bundle file

## 2. Validation
- [ ] 2.1 Run unit tests.
- [ ] 2.2 Ensure TypeScript build passes.