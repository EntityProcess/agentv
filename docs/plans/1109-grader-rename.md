Problem: Hard-rename internal AgentV terminology from Evaluator to Grader across core, SDK exports, tests, docs, and UI copy, without changing YAML kind strings or `scores[].type`.

Implementation plan:
1. Move core evaluator source/tests to `graders/` and rename registry/loader files plus exported TS symbols (`Evaluator` -> `Grader`, `EvaluatorRegistry` -> `GraderRegistry`, etc.).
2. Update dependent packages and applications (`packages/eval`, CLI, Studio) to consume the renamed symbols and user-facing terminology.
3. Sweep examples, docs, plugins, and repo guidance for concept-noun `evaluator` references; add the breaking-change migration notes required by the issue.
4. Run required validation, capture the live eval wire-format check, smoke-check Studio labels, and open/push the draft PR.

Scope guardrails:
- Keep YAML kind strings unchanged.
- Keep `scores[].type` unchanged.
- Keep `evaluation/` and `evaluate()` unchanged.
- Do not add compatibility aliases for removed `Evaluator*` symbols.
