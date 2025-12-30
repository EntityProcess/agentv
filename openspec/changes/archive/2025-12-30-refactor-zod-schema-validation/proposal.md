# Proposal: Refactor to Zod-Based Schema Validation

## Overview

Replace manual validation duplication between `targets.ts` (implementation) and `targets-validator.ts` (validation) with single-source-of-truth Zod schemas. This eliminates maintenance burden where adding a new config property requires updates in 2-3 separate locations.

## Problem

Currently, target configuration validation is split across multiple files:

1. **Implementation** (`packages/core/src/evaluation/providers/targets.ts`):
   - `CliResolvedConfig` interface defines types
   - `resolveCliConfig()` function reads `target.keep_temp_files ?? target.keepTempFiles`
   
2. **Validation** (`packages/core/src/evaluation/validation/targets-validator.ts`):
   - `CLI_SETTINGS` hardcoded Set contains allowed property names
   - Duplicate list must be manually kept in sync

3. **Parsing** (`packages/core/src/evaluation/providers/types.ts`):
   - `BASE_TARGET_SCHEMA` uses `.passthrough()` allowing unknown properties
   - Unknown properties validated separately in validator

**Consequence**: When adding `keep_temp_files` feature, we had to update 3 locations, and missed the validator initially causing warnings.

## Solution

Use Zod schemas as single source of truth:

```typescript
// Define once
const CliTargetConfigSchema = z.object({
  command_template: z.string().min(1),
  keep_temp_files: z.boolean().optional(),
  verbose: z.boolean().optional(),
  // ... etc
}).strict();  // Rejects unknown properties automatically

// Get types for free
type CliResolvedConfig = z.infer<typeof CliTargetConfigSchema>;

// Validate automatically
CliTargetConfigSchema.parse(rawConfig);
```

## Benefits

- **Single source of truth**: Add property once, get types + validation
- **Compile-time safety**: TypeScript enforces schema compliance
- **Better errors**: Zod provides detailed validation messages automatically
- **Less code**: Remove ~300 lines of manual validation
- **Already have dependency**: Zod is already in package.json
- **Industry standard**: Pattern used by Next.js, tRPC, etc.

## Scope

**In scope:**
- Migrate CLI provider config to strict Zod schema
- Remove manual property validation for CLI provider
- Update validation spec to reflect Zod approach
- Add test coverage for schema validation errors

**Out of scope:**
- Other provider types (Azure, Anthropic, etc.) - can be migrated incrementally
- Eval file validation - separate concern, tackled separately if needed
- Runtime performance optimization

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking change to validation behavior | Only affects malformed configs (already warned), not valid configs |
| Zod error messages less clear than custom | Customize with `.describe()` and error maps |
| Performance overhead | Zod is fast; validation happens once at load time |

## Dependencies

None - this is self-contained refactoring work.

## Alternatives Considered

1. **Export property lists** (short-term fix already implemented)
   - Reduces duplication but still requires manual sync
   - Doesn't solve type safety issues
   
2. **Reflection-based validation**
   - Complex, fragile, runtime overhead
   - Doesn't provide compile-time safety

3. **Keep current approach**
   - Maintenance burden increases with each new property
   - Type safety gaps continue

## Success Criteria

- [ ] Adding a new CLI provider config property requires changing only the Zod schema
- [ ] Unknown properties are rejected with clear error messages
- [ ] All existing valid configs pass validation
- [ ] Manual validation code in `targets-validator.ts` for CLI provider is removed
- [ ] Test coverage ≥ 90% for schema validation paths
