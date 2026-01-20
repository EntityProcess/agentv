# Tasks: Add JSONL Dataset Format Support

## Implementation Checklist

### Phase 1: Core JSONL Parser
- [x] Create `jsonl-parser.ts` module for JSONL parsing
  - [x] Implement line-by-line JSON parsing
  - [x] Handle malformed lines with clear error messages
  - [x] Validate each line matches eval case schema
  - [x] Support UTF-8 encoding
  - [x] Skip empty lines and whitespace-only lines
- [x] Create file format detector
  - [x] Detect `.jsonl` extension → route to JSONL parser
  - [x] Detect `.yaml` or `.yml` → route to existing YAML parser
  - [x] Return clear error for unsupported extensions
- [x] Implement sidecar YAML metadata loader
  - [x] Look for `<basename>.yaml` companion file
  - [x] Parse metadata fields: `description`, `dataset`, `execution`, `evaluator`
  - [x] Merge defaults with per-case overrides
  - [x] Fall back to sensible defaults if no sidecar found
- [x] Update `loadEvalCases()` function
  - [x] Add format detection logic
  - [x] Route to appropriate parser (JSONL or YAML)
  - [x] Maintain same function signature (backward compatible)
  - [x] Preserve existing error handling patterns

### Phase 2: Schema Validation
- [x] Extend TypeScript types for JSONL cases
  - [x] Verify `EvalCase` type covers all JSONL fields
  - [x] Add types for sidecar metadata structure
  - [x] Ensure per-line overrides type-check correctly
- [x] Add validation for JSONL-specific scenarios
  - [x] Validate line-level `execution` overrides
  - [x] Validate line-level `evaluators` array
  - [x] Validate line-level `rubrics` array
  - [x] Ensure same file reference resolution as YAML
- [x] Add error reporting for invalid JSONL
  - [x] Report line number for parse failures
  - [x] Indicate which field is invalid
  - [x] Suggest fixes for common errors

### Phase 3: File Reference Resolution
- [x] Verify file reference resolution works with JSONL
  - [x] Resolve paths relative to JSONL file location
  - [x] Support `type: file` content blocks
  - [x] Handle guideline files (`.instructions.md`)
  - [x] Same search root logic as YAML
- [x] Test with nested directories
  - [x] JSONL in `evals/subfolder/test.jsonl`
  - [x] File references like `./data/input.txt`
  - [x] Ensure correct path resolution

### Phase 4: Testing
- [x] Unit tests for JSONL parser
  - [x] Parse valid single-line JSONL
  - [x] Parse multi-line JSONL dataset
  - [x] Handle empty files gracefully
  - [x] Skip empty lines and whitespace
  - [x] Error on malformed JSON
  - [x] Error on missing required fields (`id`, `expected_outcome`, `input_messages`)
- [x] Unit tests for sidecar metadata
  - [x] Load metadata from companion YAML
  - [x] Merge defaults with per-line overrides
  - [x] Handle missing sidecar gracefully
  - [x] Apply correct precedence (line overrides sidecar)
- [x] Integration tests
  - [x] End-to-end eval run with JSONL dataset
  - [x] Verify file references resolve correctly
  - [x] Test with multiple evaluators
  - [x] Test with per-case execution overrides
  - [x] Verify trace capture works with JSONL
- [x] Regression tests
  - [x] Ensure YAML parsing unchanged
  - [x] Verify backward compatibility
  - [x] Test mixed repos (YAML + JSONL)

### Phase 5: Documentation
- [x] Update README with JSONL examples
- [x] Document JSONL in eval-builder skill (SKILL.md)
  - [x] Basic JSONL structure
  - [x] Sidecar metadata usage
  - [x] Per-case overrides
  - [x] File reference examples
- [x] Add JSONL examples to `examples/` directory
  - [x] `examples/features/basic-jsonl/` - JSONL version of basic example
  - [x] With sidecar metadata
  - [x] With per-case execution overrides
  - [x] With file references (points to basic example files)

### Phase 6: Error Messages & DX
- [x] Improve error messages for JSONL
  - [x] "Line 42: Invalid JSON syntax"
  - [x] "Line 10: Missing required field 'id'"
  - [x] "Sidecar file 'dataset.yaml' not found (using defaults)"
- [x] Add verbose logging for JSONL loading
  - [x] Log sidecar metadata discovery
  - [x] Log number of cases loaded
  - [x] Log per-case override application
- [x] Validate with `openspec validate --strict`

## Validation Steps

After implementation:
1. Run `bun run build` - Ensure no compilation errors ✓
2. Run `bun run typecheck` - Verify TypeScript types ✓
3. Run `bun run lint` - Check code style ✓
4. Run `bun test` - All tests pass ✓
5. Run examples with JSONL datasets ✓
6. Validate backward compatibility with existing YAML files ✓

## Dependencies

- No new external dependencies required
- Uses existing Node.js `fs/promises` and `path` modules
- Reuses existing validation and file resolution logic

## Parallelizable Work

These can be done independently:
- JSONL parser implementation (Phase 1) and Testing setup (Phase 4) can start together
- Documentation (Phase 5) can be drafted while implementation is in progress
- Example files can be created early for testing

## Estimated Effort

- **Phase 1-3**: Core implementation - 2-3 hours
- **Phase 4**: Testing - 1-2 hours
- **Phase 5**: Documentation - 1 hour
- **Phase 6**: Polish - 30 minutes

**Total**: ~5-7 hours for complete implementation
