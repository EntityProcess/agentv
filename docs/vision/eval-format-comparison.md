# Evaluation Formats Comparison

This note summarizes how three reference projects structure agent evaluation workflows. It serves as a rationale baseline for evolving AgentEvo’s YAML panel format.

## Agent Lightning
- **Artifacts**: Rewards serialized as OpenTelemetry spans (`al.reward` with `score`, `pass`, `reason`). Datasets expressed as Python/TypedDict models or JSONL/Parquet tables.
- **Configuration**: Hydra/OmegaConf YAML for PPO/VERL training (`trainer`, `algorithm`, `evaluator`). Additional JSON-compatible blobs for APO optimization (`run_id`, `artifacts`, `reward_spans`).
- **Metrics**: Mix of deterministic scorers (Spider EM/F1) and LLM-graded feedback encoded via POML templates.
- **Strengths**: Span-based telemetry is language agnostic; JSON-compatible data structures; flexible mix of rule and LLM judges.
- **Gaps**: Schemas live in Python; no single declarative panel file; heavy reliance on runtime code for validation.

## AX
- **Artifacts**: Evaluations written directly in TypeScript. Signatures declare inputs/outputs; examples are arrays of typed objects; metric functions compute scores.
- **Configuration**: No standalone YAML—benchmark logic is code-first. Optimizer checkpoints saved as JSON (`signature`, `metric`, `scores`, `config`).
- **Metrics**: Functions returning scalar or structured scores; reusable helpers (`exactMatch`, `semanticEquivalence`).
- **Strengths**: Strong type-safety, single source of truth with runtime code, straightforward JSON export of states.
- **Gaps**: High barrier for non-developers; CLI must compile TS modules to run; lacks declarative spec for tooling to ingest.

## Promptflow
- **Artifacts**: YAML DAGs (`$schema`, `inputs`, `outputs`, `nodes`). Evaluation flows flagged with `type: evaluation` and nodes marked `aggregation: true`.
- **Configuration**: Flow YAML references datasets (JSONL) and other runs via column macros (`${run.outputs.prediction}`). Aggregation nodes call Python scripts to emit metrics.
- **Metrics**: Implemented as Python functions or LLM nodes. Metrics computed in aggregation step and serialized to `evaluation_results.json`.
- **Strengths**: Declarative DAG enables mixed tooling; aggregation flag cleanly separates per-item vs summary; CLI/SDK integrate tightly.
- **Gaps**: Metric semantics live in Python; string macros are brittle; limited explicit schema for evaluation outcomes.

## bbeval
- **Artifacts**: YAML `.test.yaml` suites with optional `description`, `grader`, `target`, `note`, and `testcases`. Each testcase carries multi-turn messages where `content` arrays mix free text, slash-command payloads, and `type: file` references (for example the WTG.AI.Prompts `evals/development/git-diff-summary.test.yaml` loads `/plugins/development/skills/git-diff-summary/SKILL.md`).
- **Configuration**: `.bbeval/targets.yaml` maps logical targets onto providers (Azure, Anthropic, VS Code, VS Code Insiders, mock) using environment variables. Suites can override `target` or rely on CLI flags, and shared instruction bundles live under plugin directories (see WTG.AI.Prompts `.bbeval/targets.yaml` plus `plugins/**/skills` resources).
- **Metrics**: Default scorer derives aspects from the assistant transcripts and reports `hits`, `misses`, and `expected_aspect_count`. Setting `grader: llm_judge` (as in `evals/development/git-diff-summary.test.yaml`) routes through DSPy judge signatures; other suites fall back to aspect matching while still writing JSONL rows with raw request metadata for auditability.
- **Strengths**: Provider abstraction keeps suites portable; instruction injection enables large reusable knowledge bases (e.g., chatmode tests loading `/plugins/base/chatmodes/prudent.chatmode.md`); slash-command prompts let suites exercise tool-style flows; timeout/retry logic plus per-session directories guard VS Code agent runs; complex inventories in WTG.AI.Prompts show the approach scaling across dozens of skills.
- **Gaps**: Schema remains Python-only; scoring primarily string overlap with no semantic embeddings or diff tooling; no dataset abstraction for sharing fixtures across suites; heavy use of repo-relative file paths complicates portability outside curated workspaces.

## Implications for AgentEvo YAML
- Share Agent Lightning's structured telemetry (spans, reward schema) while exposing a declarative panel file.
- Borrow AX's type-safety by backing YAML with generated TypeScript interfaces/validators.
- Adopt Promptflow's separation of per-task execution vs aggregation, but define evaluators declaratively so logic is discoverable without Python code.
- Leverage bbeval's target abstraction pattern to decouple test specifications from execution providers, enabling flexible multi-provider evaluation.
- Support multi-turn conversation patterns with instruction file references (bbeval) to inject domain-specific guidelines without polluting test cases.
- Incorporate session-based artifact management (bbeval) to prevent race conditions in concurrent evaluation scenarios.
- Consider both aspect-based scoring (bbeval) and LLM judge patterns for flexible evaluation strategies.
- Permit single-case YAML datasets that literally reuse BbEval's `evalcases` structure (agent-facing turns under `input.messages`, gold replies under `expected.messages`, outcome description/rubric bundled inside `expected.outcome`, optional execution overrides for target/grader) so non-developers can drop in conversation-style scenarios without touching JSONL.
- Publish a machine-readable schema (see `docs/vision/eval-schema.json`) so tooling can validate panels the same way Promptflow enforces DAG integrity, including multi-checkpoint grouping via `conversationId`/`checkpoint` and guarded enums for roles/content types.

These insights motivate the proposed YAML structure: datasets + tasks + reusable evaluators + scoring + reporting, all validated via a TypeScript schema and able to emit structured telemetry for downstream tooling.