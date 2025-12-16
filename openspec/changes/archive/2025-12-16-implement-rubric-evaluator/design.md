# Design: Rubric Evaluator

## Architecture

The `RubricEvaluator` will be a new implementation of the `Evaluator` interface. It introduces a two-step evaluation process (optional generation -> grading) and structured outputs.

### 1. Rubric Evaluator Logic

The evaluator is designed to be **strictly deterministic**.

1.  **Static Mode Only**: The evaluator expects `rubrics` to be present in the configuration. It proceeds directly to grading.
2.  **No Dynamic Fallback**: If rubrics are missing, the evaluator will throw an error or skip the case, instructing the user to run `agentv generate rubrics`.

### 2. CLI Command: `generate rubrics`

A new CLI command group `generate` will be introduced, with `rubrics` as its first subcommand.
*   **Command**: `agentv generate rubrics <file>`
*   **Input**: Reads YAML files with `expected_outcome` but missing `rubrics`.
*   **Process**: Calls an LLM to generate rubric items for each case.
*   **Output**: Updates the YAML file in-place with the generated `rubrics`.

This structure allows for future expansion, such as `agentv generate evals` for synthetic data generation.

**Dependencies**:
- `ai` (Vercel AI SDK): For `generateObject`.
- `zod`: For schemas.
- `yaml`: For parsing and updating YAML files while preserving comments/structure (if possible, or use a robust AST-based updater).

### 2. Data Models

**Rubric Item**:
```typescript
type RubricItem = {
  id: string;
  description: string;
  weight: number; // default 1.0
  required: boolean; // default true
};
```

**Evaluation Score Update**:
The `EvaluationScore` interface needs to be expanded to support categorical verdicts, not just numeric scores.
```typescript
interface EvaluationScore {
  score: number;
  verdict?: 'pass' | 'fail' | 'borderline';
  // ... existing fields
}
```

### 3. YAML Configuration (Syntactic Sugar)

To improve developer experience, we will allow defining rubrics directly on the test case.

**YAML Input**:
```yaml
- id: test-1
  expected_outcome: "User must be warned."
  rubrics:
    - "Must contain warning text"
```

**Parsed Internal Representation**:
The `yaml-parser` will transform this into:
```typescript
{
  id: "test-1",
  expected_outcome: "User must be warned.",
  evaluators: [
    {
      type: "rubric",
      rubrics: [{ description: "Must contain warning text", ... }]
    }
  ]
}
```

### 4. Backward Compatibility

- `outcome` field in YAML will be mapped to `expected_outcome`.
- Existing `llm_judge` evaluators remain unchanged.

## Trade-offs

- **Complexity**: Dynamic generation adds latency and cost (two LLM calls). *Mitigation*: We can implement caching for generated rubrics in the future if needed, but for now, per-run generation is acceptable for correctness.
- **Dependency**: Adds dependency on `zod` (already present in repo) and specific `ai` SDK features.
