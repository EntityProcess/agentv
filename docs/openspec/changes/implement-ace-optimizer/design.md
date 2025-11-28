# Design: ACE Optimizer Integration

## Architecture

The optimization feature will be implemented as a new module in `@agentv/core` and exposed via the CLI.

### 1. Configuration Schema
We will introduce a new configuration type for Optimizers.
File extension: `.yaml` (e.g., `optimizers/ace-code-generation.yaml`).

```yaml
description: string
type: "ace"
eval_files: string[] # Paths to eval files
playbook_path: string # Path to save/load the playbook
max_epochs: number
max_reflector_rounds: number
allow_dynamic_sections: boolean
```

### 2. Core Implementation (`packages/core`)

**New Module: `optimization`**
- `OptimizerConfig`: Zod schema for the configuration.
- `Optimizer`: Interface for optimization strategies.
- `AceOptimizer`: Implementation using `@ax-llm/ax`.

**Integration with Evaluation**
- The `AceOptimizer` needs to run evaluations to measure performance.
- We will reuse the existing `EvaluationEngine` (or equivalent) to run the test cases defined in `eval_files`.
- The optimizer will iterate:
    1.  Ax generates a candidate (or updates the playbook).
    2.  AgentV runs the evals using the candidate.
    3.  AgentV computes a score (e.g., success rate).
    4.  Ax uses the score to improve.

### 3. CLI Implementation (`apps/cli`)

**New Command: `optimize`**
- Usage: `agentv optimize <config-file>`
- Responsibilities:
    - Load and validate the optimizer config.
    - Resolve paths (eval files, playbook).
    - Instantiate the optimizer.
    - Run the optimization loop.
    - Report progress to the console.

### 4. Ax Integration
- We will add `@ax-llm/ax` as a dependency to `@agentv/core`.
- We will map AgentV's `EvalResult` to the feedback format expected by Ax's ACE.

## Data Flow

1.  **User** runs `agentv optimize my-config.yaml`.
2.  **CLI** reads `my-config.yaml`.
3.  **CLI** initializes `AceOptimizer` with the config.
4.  **AceOptimizer** loads the `playbook` (if exists).
5.  **AceOptimizer** starts the optimization loop.
6.  **AceOptimizer** requests evaluation of the current state.
7.  **EvaluationRunner** (from core) runs the specified `eval_files`.
8.  **EvaluationRunner** returns metrics (e.g., correctness score).
9.  **AceOptimizer** updates the `playbook` based on metrics and reflection.
10. **AceOptimizer** saves the `playbook` to disk.
