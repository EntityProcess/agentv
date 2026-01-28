# Tasks: Adopt TypeScript Template Literals for Custom Evaluator Prompts

## SDK (`@agentv/eval`)

- [ ] Add `PromptTemplateInput` type to `packages/eval/src/schemas.ts` (reuse CodeJudgeInput fields) <!-- id: add-input-schema -->
- [ ] Add `definePromptTemplate` wrapper to `packages/eval/src/prompt-template.ts` <!-- id: add-wrapper -->
- [ ] Export `definePromptTemplate` and `PromptTemplateInput` from `packages/eval/src/index.ts` <!-- id: export-sdk -->

## Core (`@agentv/core`)

- [ ] Add `executePromptTemplate` function to execute `.ts`/`.js` prompt files as subprocesses <!-- id: add-executor -->
- [ ] Update `resolveCustomPrompt` in `orchestrator.ts` to detect and handle executable prompts <!-- id: update-loader -->

## Testing

- [ ] Add unit tests for `definePromptTemplate` stdin/stdout handling <!-- id: test-wrapper -->
- [ ] Add integration tests for executable prompt templates in eval runs <!-- id: test-integration -->

## Documentation

- [ ] Create example prompt template in `examples/features/prompt-template-sdk/` <!-- id: create-example -->
- [ ] Update skill reference docs with prompt template pattern <!-- id: update-docs -->
