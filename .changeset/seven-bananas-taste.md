---
"@agentv/core": major
"agentv": major
---

**BREAKING CHANGE**: Convert JSONL output to snake_case for Python ecosystem compatibility

All JSONL output keys are now in snake_case instead of camelCase (e.g., `eval_id` instead of `evalId`, `candidate_answer` instead of `candidateAnswer`). This aligns with Python ecosystem standards used by OpenAI Evals, MLflow, and HuggingFace.

**Changes:**
- JSONL result files now use snake_case keys
- code_judge input payloads converted to snake_case for Python script compatibility
- Proper nouns preserved (e.g., tool names like "Read", "Edit" remain unchanged)
- TypeScript internals remain camelCase (no internal API changes)

**Migration:**
If you have scripts parsing AgentV JSONL output, update them to use snake_case keys:
- `evalId` → `eval_id`
- `candidateAnswer` → `candidate_answer`
- `traceSummary` → `trace_summary`
- etc.
