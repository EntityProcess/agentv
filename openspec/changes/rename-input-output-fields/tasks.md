# Tasks: Add Input/Output Field Aliases and Shorthand

## 1. YAML Parser

- [ ] 1.1 Add `input` alias with string shorthand expansion
- [ ] 1.2 Add `expected_output` alias with string/object shorthand expansion
- [ ] 1.3 Ensure canonical names take precedence over aliases
- [ ] 1.4 Update JSON schema in `.claude/skills/agentv-eval-builder/references/eval-schema.json`
- [ ] 1.5 Write unit tests for aliases and shorthand

## 2. JSONL Parser

- [ ] 2.1 Add `input` alias with string shorthand expansion
- [ ] 2.2 Add `expected_output` alias with string/object shorthand expansion
- [ ] 2.3 Ensure canonical names take precedence over aliases
- [ ] 2.4 Write unit tests for aliases and shorthand

## 3. Tests

- [ ] 3.1 Add integration test: YAML with aliases and shorthand
- [ ] 3.2 Add integration test: JSONL with aliases and shorthand
- [ ] 3.3 Add integration test: Mixed canonical and alias usage

## Dependencies

- Tasks 1.x and 2.x can run in parallel
- Task 3.x requires 1.x and 2.x complete
