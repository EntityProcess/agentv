# Change: Modularize YAML Evaluation Parser

## Why

The current `packages/core/src/evaluation/yaml-parser.ts` file is ~1100 lines and mixes YAML loading, file resolution, configuration handling, message processing, segment formatting, prompt construction, and evaluator parsing. This makes the evaluation loader difficult to understand, test, and evolve.

## What Changes

- Refactor the YAML evaluation parser into smaller, focused modules under `packages/core/src/evaluation/` (file resolver, config loader, segment formatter, message processor, prompt builder, evaluator parser, and a slim orchestrator).
- Preserve the existing external behavior of `loadEvalCases()` and the evaluation YAML schema while improving internal structure and testability.
- Add targeted unit tests for each new module and strengthen integration tests around `loadEvalCases()` to guard against regressions.
- Introduce clear contracts between modules (types and interfaces) to make evaluation loading logic easier to extend.

## Impact

- Affected specs: `openspec/specs/evaluation/spec.md` (evaluation loading and YAML parsing behavior).
- Affected code: `packages/core/src/evaluation/yaml-parser.ts` plus new helper modules in `packages/core/src/evaluation/`.
- No breaking changes expected for public APIs; this is an internal refactor that should keep evaluation behavior and outputs stable.
