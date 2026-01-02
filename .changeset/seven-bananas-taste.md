---
"@agentv/core": major
"agentv": major
---

All JSONL output keys are now in snake_case instead of camelCase (e.g., `eval_id` instead of `evalId`, `candidate_answer` instead of `candidateAnswer`). This aligns with Python ecosystem standards used by OpenAI Evals, MLflow, and HuggingFace.
