# Design: JSONL Dataset Format

## Architecture Overview

### Current State

```
User → agentv CLI → loadEvalCases() → yaml-parser.ts → parse(YAML) → EvalCase[]
```

### New State

```
User → agentv CLI → loadEvalCases() → Format Detector
                                           ├→ YAML Parser (existing)
                                           └→ JSONL Parser (new)
                                                ├→ Parse JSONL lines
                                                ├→ Load sidecar metadata
                                                └→ Merge defaults → EvalCase[]
```

## Key Design Decisions

### 1. Parser Architecture

**Decision**: Create separate `jsonl-parser.ts` module alongside `yaml-parser.ts`

**Rationale**:
- Separation of concerns (YAML vs JSONL logic)
- Easier to test independently
- Maintains clarity in codebase
- Allows future format additions without cluttering one file

**Alternative considered**: Extend existing `yaml-parser.ts`
- **Rejected**: Would mix two different parsing strategies (document vs line-based)

### 2. Format Detection Strategy

**Decision**: Use file extension (`.jsonl` vs `.yaml`/`.yml`)

**Rationale**:
- Simple and explicit
- Industry standard approach
- No magic or heuristics required
- Clear user intent

**Implementation**:
```typescript
function detectFormat(filePath: string): 'yaml' | 'jsonl' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jsonl') return 'jsonl';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  throw new Error(`Unsupported file format: ${ext}`);
}
```

### 3. Sidecar Metadata Pattern

**Decision**: Optional companion YAML file with same base name

**Example**:
```
evals/
  dataset.jsonl    # Data
  dataset.yaml     # Metadata (optional)
```

**Rationale**:
- Follows industry standard (Hugging Face, Vertex AI)
- Maintains JSONL purity (every line is data)
- Avoids repetition of defaults
- Metadata remains human-readable
- Clear separation of config vs data

**Loading logic**:
1. Check for `<basename>.yaml` file
2. If found, parse metadata fields
3. If not found, use sensible defaults:
   - `dataset`: basename of JSONL file
   - `execution.target`: "default"
   - `evaluator`: "llm_judge"
   - `description`: empty

### 4. Defaults & Override Precedence

**Decision**: Sidecar provides defaults, per-line fields override

**Precedence order** (highest to lowest):
1. Per-line field (e.g., `{"execution": {"target": "openai"}}`)
2. Sidecar YAML field
3. Hard-coded defaults

**Example**:
```yaml
# dataset.yaml
execution:
  target: azure_base
evaluator: llm_judge
```

```jsonl
{"id": "test-1", "input_messages": [...]}  # Uses azure_base, llm_judge
{"id": "test-2", "input_messages": [...], "execution": {"target": "openai"}}  # Uses openai, llm_judge
{"id": "test-3", "input_messages": [...], "evaluators": [{"type": "rubric"}]}  # Uses azure_base, rubric
```

### 5. Line Parsing Strategy

**Decision**: Strict line-by-line parsing with error recovery

**Approach**:
```typescript
async function parseJsonlFile(filePath: string): Promise<RawEvalCase[]> {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  const cases: RawEvalCase[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;  // Skip empty lines
    
    try {
      const parsed = JSON.parse(line);
      if (!isJsonObject(parsed)) {
        throw new Error('Expected JSON object');
      }
      cases.push(parsed as RawEvalCase);
    } catch (error) {
      throw new Error(
        `Line ${i + 1}: Invalid JSON - ${(error as Error).message}`
      );
    }
  }
  
  return cases;
}
```

**Error handling**:
- Report line number for failures
- Stop on first error (no partial loads)
- Clear error messages for common issues

**Alternative considered**: Continue parsing after errors
- **Rejected**: Could lead to incomplete/inconsistent test runs

### 6. Schema Compatibility

**Decision**: Reuse existing `EvalCase` TypeScript type

**Rationale**:
- Zero changes to downstream code
- Same validation rules
- Same evaluator logic
- JSONL is just a different serialization format

**Field mapping**:
```typescript
// JSONL line
{
  "id": "test-1",
  "expected_outcome": "Goal",
  "input_messages": [...],
  "expected_messages": [...],
  "execution": {...},
  "evaluators": [...],
  "rubrics": [...]
}

// Maps directly to EvalCase type
type EvalCase = {
  id: string;
  conversationId?: string;
  expectedOutcome: string;
  inputMessages: TestMessage[];
  expectedMessages: TestMessage[];
  execution?: {...};
  evaluators?: [...];
  // ... rest of fields
}
```

### 7. File Reference Resolution

**Decision**: Resolve paths relative to JSONL file location (same as YAML)

**Example**:
```
evals/
  subfolder/
    test.jsonl
    attachments/
      code.py
```

```jsonl
{"id": "test", "input_messages": [{"role": "user", "content": [{"type": "file", "value": "./attachments/code.py"}]}]}
```

**Resolution**:
- `./attachments/code.py` → `evals/subfolder/attachments/code.py`
- Same `searchRoots` logic as YAML parser
- Same guideline pattern matching

### 8. Streaming vs Batch Loading

**Decision**: Load all cases into memory first (like YAML), defer streaming to future

**Rationale**:
- Maintains consistency with YAML behavior
- Simpler initial implementation
- Most datasets fit in memory
- Streaming can be added later without breaking changes

**Future enhancement path**:
```typescript
// Future: Streaming API (non-breaking addition)
async function* streamEvalCases(filePath: string) {
  // Yield cases one at a time
}
```

## Error Handling Strategy

### Parse Errors
```
Error: Failed to parse JSONL file: evals/test.jsonl
  Line 42: Unexpected token } in JSON at position 23
  
  Hint: Each line must be a complete JSON object
```

### Missing Required Fields
```
Error: Invalid eval case at line 10 in evals/test.jsonl
  Missing required field: 'expected_outcome'
  
  Required fields: id, expected_outcome, input_messages
```

### Invalid Field Types
```
Error: Invalid eval case at line 5 in evals/test.jsonl
  Field 'input_messages' must be an array, got string
```

### Sidecar Not Found (Warning, not error)
```
Warning: Sidecar metadata file not found: evals/dataset.yaml
  Using defaults: target=default, evaluator=llm_judge
```

## Testing Strategy

### Unit Tests
- Parse valid JSONL (single line, multiple lines)
- Handle empty lines and whitespace
- Error on malformed JSON
- Error on missing required fields
- Load sidecar metadata
- Merge defaults correctly
- Override precedence

### Integration Tests
- End-to-end eval run with JSONL
- File references resolve correctly
- Multiple evaluators work
- Per-case execution overrides
- Trace capture

### Regression Tests
- YAML parsing unchanged
- Backward compatibility
- Mixed YAML + JSONL in repo

## Performance Considerations

### Memory
- Load entire JSONL file into string (same as YAML)
- Parse line-by-line (better than YAML's full parse)
- Each case processed independently

### Speed
- JSON.parse() is typically faster than YAML parsing
- Line-by-line allows early error detection
- No significant performance concerns expected

### File Size
- JSONL more compact than YAML (no indentation)
- Typical eval case: ~200-500 bytes per line
- 1000 cases ≈ 200-500 KB (negligible)

## Migration Path

### From YAML to JSONL

**Option 1**: Manual conversion (for small datasets)
```bash
# Convert evalcases array to JSONL
cat dataset.yaml | yq '.evalcases[]' -o json > dataset.jsonl

# Extract metadata to sidecar
cat dataset.yaml | yq 'del(.evalcases)' > dataset-meta.yaml
```

**Option 2**: Keep YAML (no migration needed)
- YAML continues to work
- No forced migration
- Users choose format per dataset

## Future Enhancements (Out of Scope)

1. **Streaming execution**: Process cases without loading all into memory
2. **JSONL export**: Convert YAML → JSONL
3. **Compressed JSONL**: Support `.jsonl.gz` files
4. **JSON schema validation**: Formal JSON schema for JSONL format
5. **Multi-file datasets**: Split large datasets across multiple JSONL files
6. **Incremental updates**: Append new cases without re-running all

## Open Issues

None. All design decisions finalized.
