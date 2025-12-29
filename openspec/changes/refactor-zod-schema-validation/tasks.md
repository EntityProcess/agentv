# Tasks: Refactor to Zod-Based Schema Validation

## Phase 1: Add Schemas Alongside Existing Code

- [ ] Create `CliTargetInputSchema` accepting both naming conventions
- [ ] Create `CliHealthcheckSchema` with discriminated union
- [ ] Create `CliTargetConfigSchema` for normalized shape
- [ ] Add unit tests for each schema validating happy paths
- [ ] Add unit tests for schema error cases (missing required, invalid types)
- [ ] Create normalization function `normalizeCliConfig()` to resolve snake_case vs camelCase
- [ ] Add integration test that runs both old and new validation, asserts equivalence
- [ ] Add benchmark comparing validation performance (old vs new)
- [ ] Update `targets.ts` to export schemas alongside existing types

## Phase 2: Switch to Zod Validation

- [ ] Replace `resolveCliConfig()` implementation to use Zod schemas
- [ ] Create custom Zod error map for CLI provider validation messages
- [ ] Update error messages to match or improve existing clarity
- [ ] Remove manual property checking from `resolveCliConfig()`
- [ ] Update `targets-validator.ts` to skip CLI validation (Zod handles it)
- [ ] Remove `CLI_SETTINGS` Set from `targets-validator.ts`
- [ ] Remove `validateUnknownSettings()` calls for CLI provider
- [ ] Update integration tests to expect Zod error format
- [ ] Run full test suite, ensure all tests pass
- [ ] Update documentation to mention Zod-based validation

## Phase 3: Clean Up

- [ ] Remove commented-out old validation code
- [ ] Remove unused helper functions from `targets-validator.ts`
- [ ] Update `CliResolvedConfig` interface to use `z.infer` if not already
- [ ] Simplify exports from `targets.ts`
- [ ] Update CHANGELOG.md with migration notes
- [ ] Update README if validation approach is documented
- [ ] Run final benchmark to confirm no performance regression
- [ ] Archive this change proposal

## Validation Checkpoints

After each phase:
- [ ] All existing tests pass
- [ ] No TypeScript errors
- [ ] Valid configs continue to work
- [ ] Error messages are clear and actionable
- [ ] Performance is acceptable (≤ 2x slower than current)

## Documentation Updates

- [ ] Update inline code comments in `targets.ts`
- [ ] Add JSDoc to exported schemas
- [ ] Update contribution guide if it mentions validation approach
- [ ] Create migration guide for other providers (Azure, Anthropic, etc.)
