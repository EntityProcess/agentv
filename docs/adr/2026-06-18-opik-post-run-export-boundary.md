# ADR: Keep Opik export as a post-run adapter over AgentV result bundles

Date: 2026-06-18

Status: Proposed

## Context

AgentV already has the post-run artifacts an Opik exporter should consume:

- canonical per-test result rows in `index.jsonl`;
- per-test grading, timing, answer, and transcript artifacts from
  `packages/core/src/evaluation/run-artifacts.ts`, with the CLI wrapper in
  `apps/cli/src/commands/eval/artifact-writer.ts`;
- canonical trace sidecars in `outputs/execution-trace.json` using `agentv.trace.v1`;
- in-memory `EvaluationResult` and `TraceEnvelope` read models in `packages/core/src/evaluation/types.ts` and `packages/core/src/evaluation/trace-envelope.ts`.

That is the correct product boundary. AgentV remains the runner, gate, and artifact source of truth. Opik should be a projection over completed AgentV runs, not the runtime owner of AgentV execution.

Two existing constraints matter:

1. `av-vwa.16.4` is the planned vendor-neutral projection bundle that external adapters should consume.
2. `av-vwa.16.2` is the planned stable external identity and duplicate-policy work.

There is also a privacy mismatch in current artifact generation: the canonical
trace envelope builder defaults to metadata-only capture, but
`run-artifacts.ts` currently overrides that and writes execution-trace sidecars
with full content capture.

## Audit

### Result boundary

`EvaluationResult` already contains the information the Opik adapter needs:

- overall result status and score;
- per-grader scores and assertions;
- timing, token, and cost metadata;
- error metadata;
- derived trace summary and message/tool views.

`parseJsonlResults()` is already the post-run boundary for loading these results back from `index.jsonl`.

### Trace boundary

`TraceEnvelope` is the canonical trace artifact for export/import work:

- root eval identity: test id, target, suite, run id, category, experiment;
- ordered OpenInference-shaped span graph;
- capture policy and conversion warnings;
- score provenance and artifact references.

This is the right source for Opik trace/span projection.

### Current OTel export surface

`packages/core/src/observability/otel-exporter.ts` is a runtime OTel emitter. It is useful for live export, but it is the wrong boundary for the AgentV-to-Opik completed-run exporter because:

- it runs during execution rather than after a completed run;
- it does not preserve AgentV grading/assertion artifacts as first-class export inputs;
- using it as the primary integration would make Opik feel like the runner boundary instead of a projection target.

### Identity blocker

Opik’s documented manual trace/span APIs require UUID-form IDs for traces and spans, while AgentV’s current trace ids and span ids are stable hashed ids, not UUIDs. This means a first-class Opik adapter cannot safely reuse AgentV trace/span ids as Opik object ids.

Because of that, the exporter must either:

- mint Opik ids and preserve AgentV ids in metadata; or
- use a different ingestion path with its own identity model.

That decision belongs with `av-vwa.16.2`, not inside a one-off Opik exporter.

## Decision

Implement the Opik integration as a thin post-run adapter over AgentV-owned result bundles and result objects.

Do not add a second runtime tracing path and do not make Opik the runner.

Until `av-vwa.16.4` and `av-vwa.16.2` land, the smallest correct deliverable is an integration design and adapter contract, not a duplicate CLI exporter.

## Adapter contract

The future Opik adapter should consume one of these equivalent inputs:

1. `EvaluationResult[]` loaded from `index.jsonl` via `parseJsonlResults()`
2. the completed run workspace with:
   - `index.jsonl`
   - `benchmark.json`
   - per-test `grading.json`
   - per-test `timing.json`
   - per-test `outputs/execution-trace.json`

The adapter should emit or upload Opik-native objects only after the AgentV run is complete.

### Mapping

Map AgentV concepts to Opik concepts this way:

- AgentV run/test case -> Opik trace
- AgentV canonical span graph -> Opik spans
- AgentV per-grader scores -> Opik feedback scores on the trace by default
- AgentV assertion verdicts -> Opik feedback scores with `0`/`1` values and assertion text in the reason/metadata
- AgentV execution errors -> Opik trace error info and span error info where applicable
- AgentV artifact refs -> Opik trace/span metadata

Prefer trace-level feedback for aggregate evaluation signals and span-level feedback only when the score is clearly attached to one tool/LLM span.

### Privacy defaults

The adapter must default to metadata-only export:

- no raw prompt text by default;
- no raw tool arguments/results by default;
- no raw final output by default;
- no attachments by default.

Default metadata should still include stable AgentV references such as:

- `agentv.run_id`
- `agentv.test_id`
- `agentv.target`
- `agentv.suite`
- `agentv.category`
- `agentv.result_score`
- `agentv.execution_status`
- artifact-relative paths
- AgentV trace/span ids

Full prompt/tool/output capture must be explicit opt-in. When enabled, the adapter should copy the existing capture mode into export metadata so downstream anonymizer policy is auditable.

### Failure semantics

Export failures must be warning-only by default. A required mode can escalate failures to a hard error, but only through explicit configuration.

### Identity translation

The adapter must generate Opik ids separately from AgentV ids and persist the mapping in metadata:

- Opik trace/span ids satisfy Opik’s API contract;
- AgentV `trace_id`, `span_id`, `artifact_id`, `test_id`, and `target` stay visible in metadata for replay/debugging;
- retry/idempotency rules should key off the external identity work in `av-vwa.16.2`.

## Sequencing

1. Land the vendor-neutral projection bundle in `av-vwa.16.4`.
2. Land stable external identity and duplicate policy in `av-vwa.16.2`.
3. Implement the Opik adapter in `av-vwa.15.2` and have it consume that bundle.
4. Dogfood the completed path in `av-vwa.16.5`.

## Consequences

Positive:

- preserves AgentV as runner and source of truth;
- keeps Opik integration additive and post-run;
- makes privacy defaults explicit;
- avoids duplicating exporter logic before the generic projection bundle exists.

Negative:

- defers the final upload implementation until the shared export bundle and identity work are ready;
- requires one translation layer for AgentV ids to Opik ids.
