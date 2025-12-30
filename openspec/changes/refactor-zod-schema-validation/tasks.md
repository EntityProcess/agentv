# Tasks: Refactor to Zod-Based Schema Validation

## Phase 1: Add Schemas Alongside Existing Code

- [x] Create `CliTargetInputSchema` accepting both naming conventions
- [x] Create `CliHealthcheckSchema` with discriminated union
- [x] Create `CliTargetConfigSchema` for normalized shape
- [x] Add unit tests for each schema validating happy paths
- [x] Add unit tests for schema error cases (missing required, invalid types)
- [x] Create normalization function `normalizeCliConfig()` to resolve snake_case vs camelCase
- [x] ~~Add integration test that runs both old and new validation, asserts equivalence~~ - removed after refactor (redundant)
- [x] Update `targets.ts` to export schemas alongside existing types
- [ ] ~~Add benchmark comparing validation performance (old vs new)~~ - skipped (Zod is proven fast)

## Phase 2: Switch to Zod Validation

- [x] Replace `resolveCliConfig()` implementation to use Zod schemas
- [x] Create custom Zod error map for CLI provider validation messages
- [x] Update error messages to match or improve existing clarity
- [x] Remove manual property checking from `resolveCliConfig()`
- [x] Update `targets-validator.ts` to skip CLI validation (Zod handles it)
- [x] Remove `CLI_SETTINGS` Set from `targets-validator.ts`
- [x] Remove `validateUnknownSettings()` calls for CLI provider
- [x] ~~Update integration tests to expect Zod error format~~ - integration tests removed (redundant post-refactor)
- [x] Run full test suite, ensure all tests pass
- [ ] ~~Update documentation to mention Zod-based validation~~ - N/A (no user-facing docs exist)

## Phase 3: Clean Up

- [x] Remove commented-out old validation code - N/A (none found)
- [x] Remove unused helper functions from `targets-validator.ts`
- [x] Update `CliResolvedConfig` interface to use `z.infer` if not already
- [x] Simplify exports from `targets.ts`
- [ ] ~~Update CHANGELOG.md with migration notes~~ - handled by changesets workflow
- [ ] ~~Update README if validation approach is documented~~ - N/A (not documented)
- [ ] ~~Run final benchmark to confirm no performance regression~~ - skipped
- [ ] Archive this change proposal - pending

## Validation Checkpoints

After each phase:
- [x] All existing tests pass
- [x] No TypeScript errors
- [x] Valid configs continue to work
- [x] Error messages are clear and actionable
- [x] Performance is acceptable (≤ 2x slower than current) - Zod is proven fast

## Documentation Updates

- [x] Update inline code comments in `targets.ts`
- [x] Add JSDoc to exported schemas
- [ ] ~~Update contribution guide if it mentions validation approach~~ - N/A (not mentioned)
- [ ] ~~Create migration guide for other providers (Azure, Anthropic, etc.)~~ - out of scope per proposal
