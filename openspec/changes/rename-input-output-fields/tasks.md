# Tasks: Rename Input/Output Fields

## 1. Type Definitions

- [ ] 1.1 Update `EvalCase` type: rename `input_messages` to `input`
- [ ] 1.2 Update `EvalCase` type: rename `expected_messages` to `expected_output`
- [ ] 1.3 Update `CodeJudgePayload` type with new field names
- [ ] 1.4 Add `actual_output` field (rename from `candidate_answer`)

## 2. YAML Parser

- [ ] 2.1 Accept `input` field with string shorthand support
- [ ] 2.2 Accept `expected_output` field with string/object shorthand
- [ ] 2.3 Add `input_messages` → `input` alias with deprecation warning
- [ ] 2.4 Add `expected_messages` → `expected_output` alias with deprecation warning
- [ ] 2.5 Update JSON schema in `.claude/skills/agentv-eval-builder/references/eval-schema.json`
- [ ] 2.6 Write unit tests for new fields and aliases

## 3. JSONL Parser

- [ ] 3.1 Accept `input` field with string shorthand support
- [ ] 3.2 Accept `expected_output` field with string/object shorthand
- [ ] 3.3 Add `input_messages` → `input` alias
- [ ] 3.4 Add `expected_messages` → `expected_output` alias
- [ ] 3.5 Write unit tests for new fields and aliases

## 4. Code Judge Payload

- [ ] 4.1 Update `CodeEvaluator` to use `input` instead of `inputMessages`
- [ ] 4.2 Update `CodeEvaluator` to use `expected_output` instead of `expectedMessages`
- [ ] 4.3 Update `CodeEvaluator` to use `actual_output` instead of `candidateAnswer`
- [ ] 4.4 Update code judge SDK types
- [ ] 4.5 Write unit tests for payload structure

## 5. Update Examples

- [ ] 5.1 Update `examples/features/basic-jsonl/evals/dataset.jsonl`
- [ ] 5.2 Update `examples/features/basic/evals/dataset.yaml`
- [ ] 5.3 Update `examples/features/code-judge-sdk/` (eval + scripts)
- [ ] 5.4 Update `examples/features/code-judge-with-llm-calls/` (eval + scripts)
- [ ] 5.5 Update `examples/features/tool-trajectory-simple/evals/dataset.yaml`
- [ ] 5.6 Update `examples/features/tool-trajectory-advanced/evals/trace-file-demo.yaml`
- [ ] 5.7 Update `examples/showcase/export-screening/evals/dataset.yaml`
- [ ] 5.8 Update `examples/showcase/psychotherapy/evals/*.yaml`
- [ ] 5.9 Update `examples/showcase/tool-evaluation-plugins/tool-eval-demo.yaml`
- [ ] 5.10 Update remaining examples in `examples/features/` and `examples/showcase/`

## 6. Documentation

- [ ] 6.1 Update eval-builder skill schema reference
- [ ] 6.2 Update example READMEs if they reference old field names

## 7. Tests

- [ ] 7.1 Add integration test: YAML with new field names
- [ ] 7.2 Add integration test: JSONL with new field names
- [ ] 7.3 Add integration test: Backward compatibility with aliases
- [ ] 7.4 Add integration test: Code judge receives correct payload

## Dependencies

- Task 1.x must complete first (types)
- Tasks 2.x and 3.x can run in parallel after 1.x
- Task 4.x can run in parallel with 2.x and 3.x
- Task 5.x requires 2.x, 3.x, 4.x complete
- Tasks 6.x and 7.x can run after 5.x
