# Tasks: Add Evalcase Generation

## 1. Spec updates
- [ ] Update `openspec/changes/add-evalcase-generation/specs/rubric-generation/spec.md` to include `agentv generate evals`

## 2. CLI implementation
- [ ] Add `generate evals` command with required `--in/--out` and optional `--target/--limit/--concurrency/--id-prefix`
- [ ] Reuse existing target resolution logic (`targets.yaml` discovery)

## 3. Dataset readers
- [ ] Implement JSON dataset reader (array of objects)
- [ ] Implement JSONL dataset reader (one object per line)

## 4. Generation contract
- [ ] Define strict Zod schema for generated evalcase JSON
- [ ] Call provider per row and validate output against schema
- [ ] Add concurrency control and progress logging

## 5. Output
- [ ] Write YAML suite to `--out` with stable formatting
- [ ] Add summary reporting (generated count, skipped count)

## 6. Validation + release readiness
- [ ] Run `openspec validate add-evalcase-generation --strict`
- [ ] Add tests for dataset reading and schema validation
- [ ] Run `bun run build`, `bun run typecheck`, `bun run lint`, `bun test`
