# AgentV Features Examples

This directory demonstrates AgentV's evaluation features with complete, working examples. Each feature is self-contained in its own subfolder following the showcase convention.

## Directory Structure

Each feature example follows this pattern:
```
feature-name/
├── evals/
│   ├── dataset.yaml          # Primary eval file
│   ├── *.py                  # Code evaluators (if needed)
│   ├── *.md                  # LLM judge prompts (if needed)
│   └── [other eval files]    # Additional evals or fixtures
├── README.md                  # Feature documentation
└── [other feature files]      # Scripts, configs, etc.
```

## Available Features

### Basic Features (`basic/`)

Core schema demonstration showing:
- Basic features: `input_messages`, `expected_messages`
- File references and content blocks
- Conversation threading with `conversation_id`
- Multiple evaluators (code + LLM judge)
- Target overrides per eval case

**Eval file:** [basic/evals/dataset.yaml](basic/evals/dataset.yaml)

### Rubric Evaluator (`rubric/`)

Rubric evaluator feature demonstration showing:
- Inline rubrics (simple strings and detailed objects)
- `expected_outcome` field
- Rubric weights and required flags
- Verdict field (pass/fail/borderline)
- Automatic rubric generation from expected outcomes

**Eval file:** [rubric/evals/dataset.yaml](rubric/evals/dataset.yaml)

### Tool Trajectory Evaluator (`tool-trajectory/`)

Tool trajectory evaluator for agent execution validation:
- `any_order` mode: Validates minimum tool call counts (tools can appear in any order)
- `in_order` mode: Validates tools appear in expected sequence (allows gaps)
- `exact` mode: Validates exact tool sequence match (no gaps, no extra tools)

**Eval files:** 
- [tool-trajectory/evals/dataset.yaml](tool-trajectory/evals/dataset.yaml)
- [tool-trajectory/evals/trace-file-demo.yaml](tool-trajectory/evals/trace-file-demo.yaml)

**Setup for tool-trajectory demos:**

1. Create a `.env` file in `examples/features/` with:
   ```
   TOOL_TRAJECTORY_DIR=/absolute/path/to/examples/features/tool-trajectory
   ```

2. Run the demos:
   ```bash
   cd examples/features
   npx agentv eval tool-trajectory/evals/dataset.yaml --target mock_agent
   ```

Note: These demos use a mock CLI agent that simulates tool usage. For real agent evaluation, use providers that return trace data (e.g., codex, vscode)

### Composite Evaluator (`composite/`)

Demonstrates composite evaluation patterns.

**Eval file:** [composite/evals/dataset.yaml](composite/evals/dataset.yaml)

### Compare (`compare/`)

Demonstrates comparison of baseline and candidate evaluation results.

**Files:** [compare/evals/](compare/evals/)

### Weighted Evaluators (`weighted-evaluators/`)

Shows how to use weighted evaluator configurations.

**Eval file:** [weighted-evaluators/evals/dataset.yaml](weighted-evaluators/evals/dataset.yaml)

### Execution Metrics (`execution-metrics/`)

Demonstrates tracking and evaluation of execution performance metrics.

**Eval file:** [execution-metrics/evals/dataset.yaml](execution-metrics/evals/dataset.yaml)

### Local CLI Provider (`local-cli/`)

Shows how to invoke a CLI target with file attachments using the template-based CLI provider.

**Eval file:** [local-cli/evals/dataset.yaml](local-cli/evals/dataset.yaml)

### Batch CLI (`batch-cli/`)

Demonstrates batch evaluation using CLI targets.

**Eval file:** [batch-cli/evals/dataset.yaml](batch-cli/evals/dataset.yaml)

## Document Extraction (`document-extraction/`)

Invoice data extraction evaluation (see dedicated README in that folder).

**Eval file:** [document-extraction/evals/dataset.yaml](document-extraction/evals/dataset.yaml)

