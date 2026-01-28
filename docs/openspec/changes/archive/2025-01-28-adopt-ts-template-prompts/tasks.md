# Tasks: Adopt TypeScript Template Literals for Custom Evaluator Prompts

## SDK (`@agentv/eval`)

- [x] Add `PromptTemplateInput` type to `packages/eval/src/schemas.ts` (reuse CodeJudgeInput fields) <!-- id: add-input-schema -->
- [x] Add `definePromptTemplate` wrapper to `packages/eval/src/prompt-template.ts` <!-- id: add-wrapper -->
- [x] Export `definePromptTemplate` and `PromptTemplateInput` from `packages/eval/src/index.ts` <!-- id: export-sdk -->

## Core (`@agentv/core`)

- [x] Add `executePromptTemplate` function to execute `.ts`/`.js` prompt files as subprocesses <!-- id: add-executor -->
- [x] Update `resolveCustomPrompt` in `orchestrator.ts` to detect and handle executable prompts <!-- id: update-loader -->

## Testing

- [x] Add unit tests for `definePromptTemplate` stdin/stdout handling <!-- id: test-wrapper -->
- [x] Add integration tests for executable prompt templates in eval runs <!-- id: test-integration -->

## Documentation

- [x] Create example prompt template in `examples/features/prompt-template-sdk/` <!-- id: create-example -->
- [ ] Update skill reference docs with prompt template pattern <!-- id: update-docs -->
