---
"@agentv/core": minor
"agentv": minor
---

Add composite evaluator for combining multiple evaluators with aggregation strategies

- **Composite evaluator type**: Combine multiple evaluators (llm_judge, code, or nested composites) into a single evaluation
- **Aggregation strategies**:
  - `weighted_average`: Combine scores using configurable weights
  - `code_judge`: Custom aggregation logic via external script
  - `llm_judge`: LLM-based conflict resolution between evaluators
- **Nested composite support**: Composites can contain other composites for hierarchical evaluation structures
- **Detailed result output**: Child evaluator results are shown with individual scores, weights, and reasoning via `evaluator_results` field
