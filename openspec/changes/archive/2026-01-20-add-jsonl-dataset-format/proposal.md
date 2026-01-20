# Proposal: Add JSONL Dataset Format Support

## Summary

Add support for JSONL (JSON Lines) format as an alternative to YAML for defining evaluation datasets, following industry standards observed in DeepEval, LangWatch, and other ML/AI frameworks.

## Why

JSONL support enables large-scale evaluation workflows that are currently impractical with YAML:

1. **Streaming & Memory Efficiency**: JSONL allows line-by-line processing without loading entire datasets into memory, critical for datasets with thousands of test cases
2. **Git Workflow Improvements**: Line-based diffs clearly show which specific test cases changed, unlike nested YAML diffs
3. **Programmatic Generation**: Scripts can easily append new test cases to JSONL files without parsing/reformatting YAML
4. **Industry Alignment**: Follows established patterns from DeepEval, LangWatch, Hugging Face, and OpenAI fine-tuning datasets
5. **Tool Compatibility**: Standard JSONL tools (`jq`, `grep`, streaming parsers) work with AgentV datasets

This addresses the "Align with Industry Standards" design principle from AGENTS.md and supports AgentV's goal of robust, large-scale AI agent evaluation.

## Motivation

### Current State
AgentV currently uses YAML exclusively for eval datasets. While YAML is human-readable and suitable for hand-authored test cases, it has limitations for large-scale evaluation:

1. **Memory overhead**: Entire file must be parsed into memory
2. **Not streaming-friendly**: Cannot process eval cases incrementally
3. **Poor Git diffs**: Nested YAML changes produce unclear diffs
4. **Append-unfriendly**: Adding test cases requires careful YAML formatting

### Industry Research

Research of major ML/AI frameworks shows strong adoption of JSONL for datasets:

- **DeepEval**: Explicit JSONL support with `save_as(file_type='jsonl')`
- **LangWatch**: Full JSONL support in UI and backend parsing
- **Hugging Face**: Pure JSONL data files with sidecar README.md metadata
- **OpenAI**: Pure JSONL for fine-tuning datasets with API-managed metadata

**Key finding**: 100% of frameworks use **pure JSONL** (data only) with **separate metadata storage** (sidecar files or API-managed). Zero frameworks use first-line metadata approach.

### Benefits of JSONL Support

1. **Streaming**: Process eval cases line-by-line without loading entire file
2. **Memory efficiency**: Critical for datasets with hundreds/thousands of cases
3. **Git-friendly**: Line-based diffs clearly show which test cases changed
4. **Append-friendly**: Add cases with simple file append operations
5. **Tool compatibility**: Works with standard tools like `jq`, `grep`, streaming parsers
6. **Industry standard**: Aligns with established ML/AI framework patterns

### Design Decision: Sidecar Metadata

Following industry standard (Hugging Face, Vertex AI), metadata will be stored in a separate YAML file:

```
evals/
  dataset.yaml       # Metadata: description, defaults
  dataset.jsonl      # Pure eval cases (one per line)
```

This approach:
- Maintains JSONL purity (every line is data)
- Avoids repetition of defaults across thousands of lines
- Keeps metadata human-readable
- Supports dataset-level configuration (description, target, evaluator)

## Proposed Changes

### 1. JSONL File Format

**Pure data** - one eval case per line:

```jsonl
{"id": "test-1", "expected_outcome": "Description", "input_messages": [{"role": "user", "content": "Query"}], "expected_messages": [{"role": "assistant", "content": "Response"}]}
{"id": "test-2", "expected_outcome": "Another test", "input_messages": [{"role": "user", "content": "Query 2"}]}
{"id": "test-3", "expected_outcome": "Override example", "input_messages": [...], "execution": {"target": "specific_target"}}
```

**Schema per line**:
- Required: `id`, `expected_outcome`, `input_messages`
- Optional: `conversation_id`, `expected_messages`, `execution`, `evaluators`, `rubrics`
- Same field structure as YAML `evalcases` array entries

### 2. Sidecar YAML for Metadata

**Optional companion file** with same base name:

```yaml
# dataset.yaml (metadata only)
description: Cross-provider evaluation dataset
dataset: multi-target-test
execution:
  target: azure_base  # Default for all cases
evaluator: llm_judge  # Default evaluator
```

### 3. Resolution Strategy

1. **JSONL detection**: File extension `.jsonl` triggers JSONL parser
2. **Metadata loading**: Look for `<basename>.yaml` sidecar
   - `dataset.jsonl` → check for `dataset.yaml`
   - If not found, use sensible defaults
3. **Defaults + overrides**: Sidecar provides defaults, per-line fields override
4. **Backward compatibility**: YAML-only files work unchanged

### 4. Implementation Scope

**In scope**:
- JSONL parser for eval cases
- Sidecar YAML metadata loading
- File format detection (`.jsonl` extension)
- Same validation as YAML cases
- Same file reference resolution (relative paths)

**Out of scope** (future enhancements):
- JSONL for config.yaml or targets.yaml
- Streaming execution (load all cases first, like YAML)
- Mixed formats in single file
- JSONL generation/export tools

## User Impact

### Breaking Changes
None. This is purely additive.

### Migration Path
No migration required. YAML files continue to work unchanged.

### New Capabilities

1. **Large datasets**: Users can create evaluation suites with thousands of cases
2. **Programmatic generation**: Scripts can append to JSONL files easily
3. **Git workflows**: Clearer diffs when cases are added/modified
4. **Tool integration**: Standard JSONL tools work with AgentV datasets

## Examples

### Example 1: Basic JSONL Dataset

**dataset.jsonl**:
```jsonl
{"id": "basic-test", "expected_outcome": "Agent provides helpful response", "input_messages": [{"role": "user", "content": "What is 2+2?"}]}
{"id": "code-review", "expected_outcome": "Identifies bug", "input_messages": [{"role": "user", "content": "Review this code"}], "expected_messages": [{"role": "assistant", "content": "Found bug in line 5"}]}
```

**dataset.yaml** (optional):
```yaml
description: Basic math and code review tests
execution:
  target: default
```

### Example 2: Per-Case Overrides

**dataset.jsonl**:
```jsonl
{"id": "azure-test", "expected_outcome": "Uses Azure target", "input_messages": [...]}
{"id": "openai-test", "expected_outcome": "Uses OpenAI target", "input_messages": [...], "execution": {"target": "openai_gpt4"}}
{"id": "custom-eval", "expected_outcome": "Uses rubric evaluator", "input_messages": [...], "evaluators": [{"type": "rubric", "rubrics": ["Must be polite"]}]}
```

**dataset.yaml**:
```yaml
execution:
  target: azure_base  # Default, overridden by line 2
evaluator: llm_judge  # Default, overridden by line 3
```

### Example 3: File References (Relative Paths)

**dataset.jsonl**:
```jsonl
{"id": "with-attachments", "expected_outcome": "Reviews code", "input_messages": [{"role": "user", "content": [{"type": "text", "value": "Review this"}, {"type": "file", "value": "./code.py"}]}]}
```

File references resolve relative to the JSONL file location (same as YAML).

## Alternatives Considered

### 1. First-line metadata (REJECTED)
```jsonl
{"_meta": true, "description": "...", "dataset": "..."}
{"id": "test-1", ...}
```

**Why rejected**: 
- Not used by any major ML/AI framework
- Breaks JSONL purity (special first line)
- Incompatible with standard JSONL tools
- Complicates concatenation and streaming

### 2. Inline repetition (REJECTED)
```jsonl
{"id": "test-1", "execution": {"target": "azure_base"}, ...}
{"id": "test-2", "execution": {"target": "azure_base"}, ...}
```

**Why rejected**:
- Massive redundancy for datasets with thousands of cases
- Violates DRY principle
- Larger file sizes
- Harder to change defaults

### 3. JSON array format (REJECTED)
```json
{
  "description": "...",
  "evalcases": [...]
}
```

**Why rejected**:
- Not line-oriented (same limitations as YAML)
- Can't stream or incrementally process
- Same poor Git diff behavior
- Doesn't solve the problems JSONL addresses

## Success Criteria

1. ✅ JSONL files with `.jsonl` extension are parsed correctly
2. ✅ Sidecar YAML metadata is loaded when present
3. ✅ Per-line overrides work (execution, evaluators, rubrics)
4. ✅ File references resolve relative to JSONL file
5. ✅ Same validation rules as YAML eval cases
6. ✅ Backward compatibility: existing YAML files unchanged
7. ✅ Documentation updated with JSONL examples
8. ✅ Tests cover JSONL parsing and error cases

## Open Questions

None. All design decisions have been made based on industry research and established patterns.

## References

- Industry research: DeepEval, LangWatch, Hugging Face, OpenAI Fine-tuning API
- Current parser: `packages/core/src/evaluation/yaml-parser.ts`
- Related specs: `yaml-schema`, `evaluation`
