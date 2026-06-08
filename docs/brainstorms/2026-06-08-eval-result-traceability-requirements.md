---
date: 2026-06-08
topic: eval-result-traceability
---

# Eval Result Traceability Requirements

## Summary

AgentV Dashboard result detail should make an eval result traceable back to the exact eval definition that produced it: eval file, `test_id`, source YAML snapshot, grader definitions, and referenced input or grader files. The preferred v1 is a lightweight, self-contained run-source artifact written beside existing run artifacts, then surfaced in Dashboard detail views.

---

## Problem Frame

The current result artifacts explain what happened in a run, but not enough about where the definition came from. A Dashboard user can see output, score, assertions, and artifact files, yet must manually leave the run, find the source repository, locate the eval YAML, identify the right `test_id`, and resolve any file-backed inputs or grader prompts.

WTG.AI.Prompts PR #679 exposed the gap. The final eval run for `evals/cargowise/database/data-transformation-pr50857-e2e.eval.yaml` passed, and the run artifact includes `test_id`, grader scores, `input.md`, `response.md`, `grading.json`, and `benchmark.json.metadata.eval_file`. It does not provide a compact Dashboard path from a result row to the source YAML test block, the structured `type: file` snippets, or the grader definitions that produced the score.

The goal is not a full provenance system. AgentV should keep the core local-first and git-friendly: capture the eval-source facts available at run time, persist them in reviewable artifacts, and let Dashboard render them.

---

## Key Decisions

- **Self-contained run-source bundle.** Persist enough source definition material in the run directory so local and remote result repos can explain a run without requiring the original source checkout to be present.
- **Trace from result detail outward.** Start at the Dashboard result row or result detail, then reveal the eval file path, `test_id`, test source, grader source, and referenced files.
- **Reuse existing parser knowledge.** AgentV already resolves `type: file` inputs, `file://` LLM grader prompts, executable prompt scripts, code-grader cwd/script data, and included assertion templates while loading evals. V1 should reuse that information instead of reparsing YAML from scratch after the run.
- **Lightweight artifact, not provenance graph.** Store a compact manifest plus copied source snapshots or embedded snippets. Avoid cross-repo lineage, external PR modeling, or runtime dependency graphs unless a concrete eval needs them.
- **Snake case on disk.** All new persisted artifact keys use `snake_case`; TypeScript internals translate at the boundary.

---

## Requirements

**Run Source Capture**

- R1. Each eval run must record the eval file identity used for the run, including repository-relative path where available and the absolute runtime path only when no portable path can be derived.
- R2. Each result entry must map to a source test definition by `test_id` and include enough location data to show the corresponding test block or extracted test snapshot.
- R3. The run-source artifact must include the source eval definition snapshot used at execution time, not only a path back to a mutable checkout.
- R4. For each test, the artifact must record resolved input references such as YAML `type: file` items, with portable display path, content hash, and captured content or a captured artifact path.
- R5. For each grader, the artifact must record grader type, name, weight, required/min-score settings, inline rubric or assertion text, and any resolved files used by the grader.
- R6. LLM grader prompt files declared with `file://` must be captured with display path, content hash, and content or captured artifact path.
- R7. Executable prompt scripts, code-grader commands, and code-grader cwd/script resolution must be captured enough for a reviewer to identify the referenced file and command shape without exposing secrets.
- R8. Assertion template includes must be traceable as source inputs, including include path, resolved path, and expanded assertion content.

**Dashboard Behavior**

- R9. Run detail and eval detail responses must expose traceability metadata without requiring the Dashboard to read arbitrary files outside the run artifact directory.
- R10. Result detail must show a Source or Traceability panel with eval file, `test_id`, suite/category, target, source test block, grader definitions, and referenced input/grader files.
- R11. Existing Checks and Files tabs must continue to work for old run artifacts that do not contain traceability metadata.
- R12. Remote result runs must render the same traceability information after result sync, using only files present in the results repository checkout.
- R13. The UI must make missing source metadata explicit for older runs instead of implying the source is unavailable due to an error.

**Compatibility And Safety**

- R14. Existing `index.jsonl`, `benchmark.json`, `grading.json`, `input.md`, `response.md`, and `transcript.jsonl` consumers must keep working unchanged.
- R15. New artifact fields must be optional and backward compatible for historical runs.
- R16. The artifact must avoid capturing environment variables, provider credentials, or workspace-local machine secrets.
- R17. Large referenced files should be bounded by size limits with explicit truncation metadata; v1 may skip oversized content if it records path, hash when available, size, and reason.
- R18. The feature must not require a running Dashboard or remote repository during eval execution.

**Principles**

- R19. The core implementation must remain a primitive artifact writer and reader; project-specific provenance, PR analysis, and external source browsing belong outside core.
- R20. Wire artifacts and API responses must use `snake_case`; Dashboard and core TypeScript internals may use `camelCase`.
- R21. The structure should be self-documenting for agents, with field names that describe source identity, resolved references, captured content, and omitted content without extra docs.

---

## Key Flows

- F1. Reviewer opens a result detail from a run row.
  - **Actor:** Dashboard reviewer.
  - **Steps:** Open project run, open an eval result, select Source or Traceability, inspect eval file path, `test_id`, source YAML snapshot, referenced input files, and grader definitions.
  - **Outcome:** The reviewer can explain exactly what was evaluated without searching the source repo manually.

- F2. CI publishes a result artifact to a remote results repo.
  - **Actor:** CI or eval runner.
  - **Steps:** Run eval, write normal artifacts, write run-source artifact, sync/publish results repo.
  - **Outcome:** A clean Dashboard can render result source metadata after remote sync without cloning the original source repo.

- F3. An old run without traceability metadata is opened.
  - **Actor:** Dashboard reviewer.
  - **Steps:** Open run detail and eval detail as today.
  - **Outcome:** Checks, output, and artifact files render normally; Source panel says source metadata was not captured for this run.

---

## Acceptance Examples

- AE1. Given the WTG.AI.Prompts PR #679 final run for `data-transformation-pr50857-e2e`, when a user opens `pr50857-online-chunking-review`, then Dashboard shows `evals/cargowise/database/data-transformation-pr50857-e2e.eval.yaml`, `test_id: pr50857-online-chunking-review`, the YAML test criteria/assertions, and the referenced snippet `evals/cargowise/database/snippets/clear-job-consol-transport-vessel-fk-online.cs`.
- AE2. Given an eval uses an `llm-grader` with `prompt: file://graders/review.md`, when the run completes, then the run-source artifact records the grader name/type, prompt display path, resolved source identity, hash, and captured prompt content or captured artifact path.
- AE3. Given an eval uses a `code-grader` command that resolves a script under the eval repo, when the run completes, then the artifact records the command shape and resolved script identity without recording environment variables or secret values.
- AE4. Given a remote results checkout contains a run-source artifact, when Dashboard loads the remote run detail, then the Source panel renders from that checkout only.
- AE5. Given a pre-feature run only has `index.jsonl` and per-test artifacts, when Dashboard opens eval detail, then existing Checks and Files views work and the Source panel reports that source metadata was not captured.

---

## Scope Boundaries

- Defer source-control commit metadata beyond existing run context unless it is already available cheaply at eval execution time.
- Defer external PR, issue, or review-thread linking; PR #679 is motivating evidence, not a required product primitive.
- Defer full workspace dependency provenance for repos listed in `workspace.repos`; this brief only requires eval definition and referenced input/grader source files.
- Defer a new hosted trace/provenance backend. Git-backed run artifacts remain the v1 source of truth.

---

## Dependencies And Assumptions

- AgentV eval loading already has access to parsed test definitions and resolved file references in `packages/core/src/evaluation/yaml-parser.ts` and `packages/core/src/evaluation/loaders/grader-parser.ts`.
- The artifact writer in `apps/cli/src/commands/eval/artifact-writer.ts` is the natural place to persist run-level and per-test source metadata beside existing artifacts.
- The Dashboard API in `apps/cli/src/commands/results/serve.ts` can hydrate traceability metadata from the run directory and expose it to `apps/dashboard/src/components/EvalDetail.tsx`.
- Remote results repositories copy run directories intact, so a self-contained run artifact should work in local and remote Dashboard paths.

---

## Sources

- WTG.AI.Prompts PR #679: https://github.com/WiseTechGlobal/WTG.AI.Prompts/pull/679
- GitHub Actions final eval run: https://github.com/WiseTechGlobal/WTG.AI.Prompts/actions/runs/26510158813
- Current artifact writer: `apps/cli/src/commands/eval/artifact-writer.ts`
- Current Dashboard result API: `apps/cli/src/commands/results/serve.ts`
- Current eval detail UI: `apps/dashboard/src/components/EvalDetail.tsx`
- Current eval YAML loader: `packages/core/src/evaluation/yaml-parser.ts`
- Current grader parser: `packages/core/src/evaluation/loaders/grader-parser.ts`
