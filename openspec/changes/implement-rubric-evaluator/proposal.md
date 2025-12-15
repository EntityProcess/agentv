# Implement Rubric Evaluator

## Summary
Implement a `RubricEvaluator` in AgentV to support dynamic and static rubric-based evaluations. This includes adding support for `verdict` (pass/fail/borderline) in evaluation scores and enhancing the YAML schema to support `expected_outcome` and inline `rubrics`.

## Motivation
Client projects currently use custom tools that generate checklists (rubrics) dynamically from task descriptions and evaluate answers against them. While Google's ADK primarily uses static, pre-defined rubrics, this dynamic generation capability is valuable for rapid test creation. To consolidate evaluation tooling into AgentV, we need to port this dynamic capability while also supporting the standard static rubric pattern found in ADK. This provides a robust, structured evaluation mechanism that is both flexible (dynamic) and deterministic (static).

## Proposed Changes
1.  **New Evaluator**: Create `RubricEvaluator` that grades answers using structured outputs (Zod schemas) against a list of rubrics.
2.  **CLI Command**: Implement `agentv generate rubrics` (under a new `generate` command group) to statically generate rubrics from `expected_outcome` and save them to the YAML file. This ensures deterministic evaluations and allows for future generators (e.g., `generate evals`).
3.  **Schema Updates**:
    *   Rename `outcome` to `expected_outcome` in YAML (with backward compatibility).
    *   Allow `rubrics` to be defined directly on `EvalCase` in YAML.
    *   Add `verdict` (`pass` | `fail` | `borderline`) to `EvaluationScore`.
4.  **Integration**: Update `yaml-parser` to configure `RubricEvaluator` from the explicit `rubrics` field. Runtime generation is NOT supported; users must run `generate rubrics` first.
