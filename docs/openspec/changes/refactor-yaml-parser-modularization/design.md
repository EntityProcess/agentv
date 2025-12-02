## Context

The YAML evaluation loader currently lives in a single large module (`yaml-parser.ts`) that handles many concerns: reading YAML files, resolving referenced files, applying guideline configuration, formatting segments, processing messages, building prompts, and configuring evaluators. This structure makes it hard to reason about behavior and to add new capabilities safely.

## Goals / Non-Goals

- Goals:
  - Split YAML parsing and evaluation loading into cohesive modules with single responsibilities.
  - Preserve the existing external behavior of `loadEvalCases()` and the evaluation schema.
  - Improve unit test coverage and make it easier to add new evaluation features.
- Non-Goals:
  - No changes to the evaluation YAML schema or CLI surface.
  - No new evaluation capabilities (e.g., streaming, parallelism) as part of this change.

## Decisions

- Decision: Introduce dedicated modules under `packages/core/src/evaluation/`:
  - `file-resolver.ts` for resolving file references and search roots.
  - `config-loader.ts` for config loading, guideline file detection, and related types.
  - `segment-formatter.ts` for segment and file content formatting.
  - `message-processor.ts` for processing and normalizing messages and assistant content.
  - `prompt-builder.ts` for constructing prompts from segments and messages.
  - `evaluator-parser.ts` for parsing evaluator configuration.
  - Keep `yaml-parser.ts` as a small orchestrator that wires these modules together and exposes `loadEvalCases()`.
- Decision: Extract existing logic into new modules first with minimal behavioral changes, then add focused unit tests and small internal cleanups where safe.
- Decision: Use shared types/interfaces across modules to document contracts (e.g., segment structures, prompt inputs, evaluator configs).

## Risks / Trade-offs

- Risk: Subtle behavior changes in file resolution, message processing, or prompt building could alter evaluation behavior.
  - Mitigation: Add regression-style integration tests around `loadEvalCases()` and snapshot key outputs before and after refactor.
- Risk: Increased module count can make navigation harder if structure is inconsistent.
  - Mitigation: Follow a clear naming and folder convention and keep orchestrator responsibilities narrow.

## Migration Plan

1. Extract file resolution and config loading helpers into `file-resolver.ts` and `config-loader.ts` and switch `yaml-parser.ts` to use them.
2. Extract segment formatting, message processing, prompt building, and evaluator parsing into their respective modules.
3. Add unit tests for each new module plus higher-level tests for `loadEvalCases()`.
4. Remove duplicated logic and simplify internals where covered by tests.
5. Keep public API (`loadEvalCases()` and related types) stable.

## Open Questions

- Do we need an explicit caching layer for resolved files or guideline patterns, or should that remain a future enhancement once modularization is complete?
- Should evaluator parsing be generalized further to support pluggable evaluator types in a follow-up change?
