# Design: Zod-Based Schema Validation

## Architectural Decision

Move from manual property validation to declarative Zod schemas that serve as both runtime validators and TypeScript type sources.

## Current Architecture

```
targets.yaml (user input)
    ↓
parse(yaml) → BASE_TARGET_SCHEMA.passthrough()
    ↓
resolveCliConfig() → reads target.prop ?? target.propAlt
    ↓
CliResolvedConfig interface (manual types)
    ↓
validateUnknownSettings() → checks CLI_SETTINGS Set
```

**Problems:**
- Types defined separately from validation
- Property names duplicated 2-3 times
- `.passthrough()` allows unknown properties through
- Manual validation happens after resolution

## Proposed Architecture

```
targets.yaml (user input)
    ↓
parse(yaml) → CliTargetSchemaLoose (allows snake_case + camelCase)
    ↓
CliTargetSchemaLoose.parse() → validates + transforms
    ↓
normalizeCliConfig() → converts snake_case to camelCase
    ↓
CliTargetSchemaStrict.parse() → validates normalized shape
    ↓
type CliResolvedConfig = z.infer<typeof CliTargetSchemaStrict>
```

**Benefits:**
- Single schema definition → types + validation
- Unknown properties rejected automatically
- Clear error messages from Zod
- Transformation logic centralized

## Schema Layers

### Layer 1: Loose Input Schema

Accepts both naming conventions from YAML:

```typescript
const CliTargetInputSchema = z.object({
  name: z.string().min(1),
  provider: z.literal('cli'),
  
  // Accept both snake_case and camelCase
  command_template: z.string().optional(),
  commandTemplate: z.string().optional(),
  
  keep_temp_files: z.boolean().optional(),
  keepTempFiles: z.boolean().optional(),
  
  // ... etc for all properties
}).refine(
  (data) => data.command_template || data.commandTemplate,
  'Either command_template or commandTemplate is required'
);
```

### Layer 2: Normalized Schema

After resolving naming variants:

```typescript
const CliTargetConfigSchema = z.object({
  name: z.string().min(1),
  provider: z.literal('cli'),
  commandTemplate: z.string().min(1),
  keepTempFiles: z.boolean().optional(),
  verbose: z.boolean().optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  filesFormat: z.string().optional(),
  healthcheck: CliHealthcheckSchema.optional(),
}).strict();

export type CliResolvedConfig = z.infer<typeof CliTargetConfigSchema>;
```

### Layer 3: Nested Schemas

For complex objects like healthcheck:

```typescript
const CliHealthcheckHttpSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  timeoutMs: z.number().positive().optional(),
});

const CliHealthcheckCommandSchema = z.object({
  type: z.literal('command'),
  commandTemplate: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
});

const CliHealthcheckSchema = z.discriminatedUnion('type', [
  CliHealthcheckHttpSchema,
  CliHealthcheckCommandSchema,
]);
```

## Migration Strategy

### Phase 1: Add schemas alongside existing code

1. Create Zod schemas in `targets.ts`
2. Keep existing validation logic
3. Run both and assert equivalence in tests
4. Compare error messages

### Phase 2: Switch to Zod validation

1. Replace `resolveCliConfig()` with schema-based approach
2. Keep error message compatibility where possible
3. Remove manual validation from `targets-validator.ts`

### Phase 3: Clean up

1. Remove `CLI_SETTINGS` Set
2. Remove `validateUnknownSettings()` for CLI
3. Update tests to use schema
4. Update documentation

## Error Message Design

Preserve clarity of existing validation:

```typescript
// Before (manual)
"Unknown setting 'keep_temp_files' for cli provider"

// After (Zod custom error map)
"Unknown property 'keep_temp_files'. Did you mean 'keepTempFiles'?"
```

Use Zod error maps for custom messages:

```typescript
const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    return { 
      message: `Unknown CLI provider settings: ${issue.keys.join(', ')}` 
    };
  }
  return { message: ctx.defaultError };
};

CliTargetConfigSchema.parse(data, { errorMap: customErrorMap });
```

## Backward Compatibility

All valid configs continue to work. Only invalid configs (that already produced warnings) will now produce errors.

**Breaking change analysis:**
- `.passthrough()` → `.strict()`: Rejects typos that were silently ignored
- This is desirable behavior - catches user mistakes earlier

## Performance Considerations

- **Load time**: Validation happens once when loading targets file (~1ms per target)
- **Runtime**: No impact - validation is pre-execution
- **Memory**: Schemas are singletons, minimal overhead

Zod is optimized for production use and used by major projects (Next.js has 1000s of schema validations per build).

## Testing Strategy

1. **Unit tests**: Each schema layer independently
2. **Integration tests**: Full resolution flow with Zod
3. **Regression tests**: All existing valid configs pass
4. **Error tests**: Invalid configs produce clear messages
5. **Benchmark**: Validate performance vs. current approach

## Rollout Plan

1. Merge Phase 1 (schemas + dual validation)
2. Collect feedback on error messages
3. Merge Phase 2 (switch to Zod)
4. Merge Phase 3 (cleanup)

Each phase is independently shippable.
