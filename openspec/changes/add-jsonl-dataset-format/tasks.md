# Tasks: Add JSONL Dataset Format Support

## Implementation Checklist

### Phase 1: Core JSONL Parser
- [ ] Create `jsonl-parser.ts` module for JSONL parsing
  - [ ] Implement line-by-line JSON parsing
  - [ ] Handle malformed lines with clear error messages
  - [ ] Validate each line matches eval case schema
  - [ ] Support UTF-8 encoding
  - [ ] Skip empty lines and whitespace-only lines
- [ ] Create file format detector
  - [ ] Detect `.jsonl` extension → route to JSONL parser
  - [ ] Detect `.yaml` or `.yml` → route to existing YAML parser
  - [ ] Return clear error for unsupported extensions
- [ ] Implement sidecar YAML metadata loader
  - [ ] Look for `<basename>.yaml` companion file
  - [ ] Parse metadata fields: `description`, `dataset`, `execution`, `evaluator`
  - [ ] Merge defaults with per-case overrides
  - [ ] Fall back to sensible defaults if no sidecar found
- [ ] Update `loadEvalCases()` function
  - [ ] Add format detection logic
  - [ ] Route to appropriate parser (JSONL or YAML)
  - [ ] Maintain same function signature (backward compatible)
  - [ ] Preserve existing error handling patterns

### Phase 2: Schema Validation
- [ ] Extend TypeScript types for JSONL cases
  - [ ] Verify `EvalCase` type covers all JSONL fields
  - [ ] Add types for sidecar metadata structure
  - [ ] Ensure per-line overrides type-check correctly
- [ ] Add validation for JSONL-specific scenarios
  - [ ] Validate line-level `execution` overrides
  - [ ] Validate line-level `evaluators` array
  - [ ] Validate line-level `rubrics` array
  - [ ] Ensure same file reference resolution as YAML
- [ ] Add error reporting for invalid JSONL
  - [ ] Report line number for parse failures
  - [ ] Indicate which field is invalid
  - [ ] Suggest fixes for common errors

### Phase 3: File Reference Resolution
- [ ] Verify file reference resolution works with JSONL
  - [ ] Resolve paths relative to JSONL file location
  - [ ] Support `type: file` content blocks
  - [ ] Handle guideline files (`.instructions.md`)
  - [ ] Same search root logic as YAML
- [ ] Test with nested directories
  - [ ] JSONL in `evals/subfolder/test.jsonl`
  - [ ] File references like `./data/input.txt`
  - [ ] Ensure correct path resolution

### Phase 4: Testing
- [ ] Unit tests for JSONL parser
  - [ ] Parse valid single-line JSONL
  - [ ] Parse multi-line JSONL dataset
  - [ ] Handle empty files gracefully
  - [ ] Skip empty lines and whitespace
  - [ ] Error on malformed JSON
  - [ ] Error on missing required fields (`id`, `expected_outcome`, `input_messages`)
- [ ] Unit tests for sidecar metadata
  - [ ] Load metadata from companion YAML
  - [ ] Merge defaults with per-line overrides
  - [ ] Handle missing sidecar gracefully
  - [ ] Apply correct precedence (line overrides sidecar)
- [ ] Integration tests
  - [ ] End-to-end eval run with JSONL dataset
  - [ ] Verify file references resolve correctly
  - [ ] Test with multiple evaluators
  - [ ] Test with per-case execution overrides
  - [ ] Verify trace capture works with JSONL
- [ ] Regression tests
  - [ ] Ensure YAML parsing unchanged
  - [ ] Verify backward compatibility
  - [ ] Test mixed repos (YAML + JSONL)

### Phase 5: Documentation
- [ ] Update README with JSONL examples
- [ ] Create JSONL tutorial in docs
  - [ ] Basic JSONL structure
  - [ ] Sidecar metadata usage
  - [ ] Per-case overrides
  - [ ] File reference examples
  - [ ] Migration tips from YAML
- [ ] Update skill files if applicable
  - [ ] Update eval-builder skill with JSONL info
  - [ ] Include JSONL schema examples
- [ ] Add JSONL examples to `examples/` directory
  - [ ] Basic JSONL dataset
  - [ ] With sidecar metadata
  - [ ] With per-case overrides
  - [ ] With file references

### Phase 6: Error Messages & DX
- [ ] Improve error messages for JSONL
  - [ ] "Line 42: Invalid JSON syntax"
  - [ ] "Line 10: Missing required field 'id'"
  - [ ] "Sidecar file 'dataset.yaml' not found (using defaults)"
- [ ] Add verbose logging for JSONL loading
  - [ ] Log sidecar metadata discovery
  - [ ] Log number of cases loaded
  - [ ] Log per-case override application
- [ ] Validate with `openspec validate --strict`

## Validation Steps

After implementation:
1. Run `bun run build` - Ensure no compilation errors
2. Run `bun run typecheck` - Verify TypeScript types
3. Run `bun run lint` - Check code style
4. Run `bun test` - All tests pass
5. Run examples with JSONL datasets
6. Validate backward compatibility with existing YAML files

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
