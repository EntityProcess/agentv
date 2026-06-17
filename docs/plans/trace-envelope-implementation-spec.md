---
title: Execution Trace Implementation Spec
type: spec
status: active
date: 2026-06-15
---

# Execution Trace Implementation Spec

## Decision And Scope

AgentV stores and interchanges full execution traces as an
`agentv.trace.v1` artifact. The canonical trace body is an
OpenTelemetry span graph with GenAI semantic convention attributes and
OpenInference attributes where they cover the concept. AgentV owns only the
small artifact wrapper around that graph: eval and replay identity, source
metadata, capture/redaction policy, conversion warnings, artifact pointers, and
score provenance.

This supersedes the older wording in `docs/plans/trace-evaluation-architecture.md`
that treats AgentV's result-local `Trace` or trajectory object as the canonical
artifact. Those objects can remain, but they must be documented and implemented
as derived read/projection views over the canonical span graph.

Source of truth:

- `trace.spans` in the execution trace artifact is the canonical ordered span body for AgentV
  trace evaluation, replay projection, export, and import.
- Official OTLP JSON is a boundary format generated from, or imported into, that
  span body. Attribute names remain exact standard names such as
  `gen_ai.operation.name` and `openinference.span.kind`.
- `Message[]`, `outputs/transcript.jsonl`, `TraceSummary`, `TraceArtifact`,
  replay target output, and compact grader inputs are derived compatibility/read
  views.
- Derived views must be named and treated as projections over
  `agentv.trace.v1`, not as separate canonical graphs:
  `traceEnvelopeToMessages()` for Provider `Message[]` and replay provider
  responses, `traceEnvelopeToTranscriptMessages()` for
  `outputs/transcript.jsonl`, `traceEnvelopeToTraceSummary()` for metrics
  aggregation, compact tool trajectory views for trajectory graders, and
  `traceEnvelopeToOtlpJson()` for OTLP/OpenInference export bodies.

Non-goals:

- Do not invent an AgentV-specific canonical trace graph.
- Do not change existing public result JSONL, `benchmark.json`, `grading.json`,
  `timing.json`, replay fixture JSONL, or `outputs/transcript.jsonl` schemas in
  the first implementation slice.
- Do not build Phoenix, Langfuse, Braintrust, or LangSmith vendor adapters here.
- Do not restart or refactor the merged replay target-output work from PR #1374.
- Do not require a live observability backend for verification.
- Do not recursively case-convert provider, user, tool, message-content, raw
  evidence, or metadata payloads that AgentV does not own.

## Wire Contract

All AgentV-owned wire fields use `snake_case`. Standard attribute keys keep their
exact spelling, including dots and namespace casing. Opaque nested payloads keep
their source keys exactly.

Directional v1 shape:

```yaml
schema_version: agentv.trace.v1
artifact_id: execution-trace-01j...
created_at: "2026-06-15T12:00:00.000Z"

eval:
  eval_id: "optional stable eval identifier"
  eval_path: examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml
  suite: "trace-evaluation"
  test_id: inspect-and-fix-config
  target: replay_coding_agent
  source_target: live_coding_agent
  attempt: 0
  variant: null
  run_id: "2026-06-15T12-00-00-000Z"
  category: showcase
  experiment: execution-trace-v1

replay:
  lookup_key:
    suite: trace-evaluation
    eval_path: examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml
    test_id: inspect-and-fix-config
    source_target: live_coding_agent
    attempt: 0
    variant: null
  fixture_id: live_coding_agent-inspect-and-fix-config-abc123
  source_fixture_path: fixtures/replay-target-output.jsonl

trace:
  format: otlp_openinference_spans
  trace_id: 4bf92f3577b34da6a3ce929d0e0e4736
  root_span_id: 00f067aa0ba902b7
  resource:
    attributes:
      service.name: agentv
      service.version: "x.y.z"
  scope:
    name: agentv
    version: "x.y.z"
  spans:
    - trace_id: 4bf92f3577b34da6a3ce929d0e0e4736
      span_id: 00f067aa0ba902b7
      parent_span_id: null
      name: invoke_agent replay_coding_agent
      kind: INTERNAL
      start_time_unix_nano: "1781524800000000000"
      end_time_unix_nano: "1781524804200000000"
      status:
        code: OK
      attributes:
        gen_ai.operation.name: invoke_agent
        gen_ai.provider.name: agentv
        gen_ai.agent.name: replay_coding_agent
        openinference.span.kind: AGENT
        session.id: session-123
        agentv.eval_path: examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml
        agentv.test_id: inspect-and-fix-config
        agentv.target: replay_coding_agent
      events:
        - name: agentv.transcript.message
          attributes:
            agentv.transcript.message.index: 0
            agentv.transcript.message:
              role: user
              content: Inspect and fix the config.

source:
  kind: agentv_run
  path: .agentv/results/runs/2026-06-15T12-00-00/index.jsonl
  provider: replay
  format: agentv_result
  version: "1"
  metadata:
    # Opaque. Preserve keys exactly.
    providerCamelKey: "kept"
    source_provider: "kept"

capture:
  content: metadata # none | metadata | full
  redaction_level: partial # none | partial | full
  redacted_fields:
    - gen_ai.input.messages
    - gen_ai.tool.call.arguments
  policy:
    tool_arguments: metadata
    tool_results: metadata
    message_text: metadata
    screenshots: none
    thinking: none

conversion_warnings:
  - code: missing_tool_call_id
    severity: warning
    span_id: "1111111111111111"
    source_ref:
      event_id: raw-tool-7
      path: fixtures/raw/session.jsonl
      line: 42
    message: Deterministic tool call id generated from source order.

artifacts:
  execution_trace_path: outputs/execution-trace.json
  otlp_path: outputs/trace.otlp.json
  answer_path: outputs/answer.md
  transcript_path: outputs/transcript.jsonl
  raw_evidence_dir: raw/

scores:
  - name: expected-tool-sequence
    type: tool-trajectory
    score: 1
    verdict: pass
    source: code
    evaluated_at: "2026-06-15T12:00:05.000Z"
    target_span_id: 00f067aa0ba902b7
    evidence:
      span_ids:
        - "2222222222222222"
      tool_call_ids:
        - call-read
      assertions:
        - text: Read was called before Edit.
          passed: true
```

Boundary conversion strategy:

- Define parallel wire and internal interfaces. Example names:
  `TraceEnvelopeWire`/`TraceEnvelope`,
  `TraceEnvelopeSpanWire`/`TraceEnvelopeSpan`,
  `TraceEnvelopeScoreWire`/`TraceEnvelopeScore`.
- Internal TypeScript fields are camelCase: `schemaVersion`, `createdAt`,
  `rootSpanId`, `conversionWarnings`, `targetSpanId`.
- Wire fields are snake_case: `schema_version`, `created_at`, `root_span_id`,
  `conversion_warnings`, `target_span_id`.
- Attribute maps are not case-converted. They are standard or vendor keys, not
  AgentV-owned structural keys.
- Opaque payload fields are typed as `unknown` or `Readonly<Record<string,
  unknown>>` and copied as-is. Do not run `toSnakeCaseDeep()` or
  `toCamelCaseDeep()` over them.
- Official OTLP JSON export/import is a separate boundary. The exporter may
  write `resourceSpans`, `scopeSpans`, `traceId`, `spanId`, and
  `startTimeUnixNano` because those names are owned by the OTLP JSON protocol,
  not by AgentV's envelope wire shape.

Implementation pattern:

```ts
interface TraceEnvelopeWire {
  readonly schema_version: 'agentv.trace.v1';
  readonly artifact_id: string;
  readonly created_at: string;
  readonly eval: TraceEnvelopeEvalWire;
  readonly trace: TraceEnvelopeBodyWire;
  readonly conversion_warnings?: readonly ConversionWarningWire[];
}

interface TraceEnvelope {
  readonly schemaVersion: 'agentv.trace.v1';
  readonly artifactId: string;
  readonly createdAt: string;
  readonly eval: TraceEnvelopeEval;
  readonly trace: TraceEnvelopeBody;
  readonly conversionWarnings?: readonly ConversionWarning[];
}
```

The serializer should look like `packages/core/src/evaluation/replay-fixtures.ts`:
explicit known-field conversion plus Zod validation. It should not look like
`toSnakeCaseDeep(record)` on a mixed AgentV/opaque object.

## Span Mapping Table

| Concept | Span representation | Known candidate standard attributes | AgentV envelope/attributes | Notes and uncertainty |
| --- | --- | --- | --- | --- |
| AgentV run/eval root | Root span named `invoke_agent <target>` for new envelopes. Accept `agentv.eval` on import for compatibility. `kind: INTERNAL` unless the source is a client call into a remote agent. | `gen_ai.operation.name=invoke_agent`; `gen_ai.provider.name`; `gen_ai.agent.name`; `gen_ai.agent.version`; `gen_ai.conversation.id`; `openinference.span.kind=AGENT`; `session.id`. | Envelope `eval.*` is authoritative. Duplicate searchable values on root as `agentv.eval_path`, `agentv.suite`, `agentv.test_id`, `agentv.target`, `agentv.run_id`, `agentv.attempt`, `agentv.variant`. | Current exporter uses `agentv.eval` and `gen_ai.operation.name=evaluate`; keep reader compatibility but do not make `evaluate` a v1 canonical requirement unless the GenAI spec stabilizes it for root spans. |
| Transcript compatibility rows | Root span events named `agentv.transcript.message` preserve ordered transcript rows needed for `outputs/transcript.jsonl`, including user/system input turns that are not provider output. | No stable OTel/OpenInference message-event shape covers AgentV's transcript JSONL compatibility artifact. | Event attribute `agentv.transcript.message.index` stores source order. Event attribute `agentv.transcript.message` stores a snake_case message object (`role`, `content`, `tool_calls`, `start_time`, `end_time`, `duration_ms`, `metadata`, `token_usage`). | `traceEnvelopeToTranscriptMessages()` uses these events for transcript JSONL. `traceEnvelopeToMessages()` intentionally remains assistant/output-only for replay provider responses. Opaque content, metadata, and tool input/output payload keys are preserved exactly inside the message object. |
| Model/chat span | Child span named `chat <model>` for each model turn. Parent is root agent span or the source parent span if importing external OTel. | `gen_ai.operation.name=chat`; `gen_ai.provider.name`; `gen_ai.request.model`; `gen_ai.response.model`; `gen_ai.response.id`; `gen_ai.response.finish_reasons`; `gen_ai.input.messages` opt-in; `gen_ai.output.messages` opt-in; `openinference.span.kind=LLM`; `llm.system`; `llm.provider`; `llm.model_name`; `input.value`; `output.value`; `input.mime_type`; `output.mime_type`. | `agentv.turn_index`, `agentv.message_index`, `agentv.source_event_id` only when standards do not carry the identity. | Content attributes are sensitive and must follow `capture.content`. Preserve message payload keys when storing structured content internally or in raw evidence. |
| Tool execution span | Span named `execute_tool <tool_name>`. For AgentV-generated traces, parent it to the chat span that requested the tool when known; otherwise parent it to the root agent span. | `gen_ai.operation.name=execute_tool`; `gen_ai.tool.name`; `gen_ai.tool.call.id`; `gen_ai.tool.type`; `gen_ai.tool.description`; `gen_ai.tool.call.arguments` opt-in; `gen_ai.tool.call.result` opt-in; `openinference.span.kind=TOOL`; `tool.name`; `tool.id`; `tool.description`; `tool.json_schema`; `input.value`; `output.value`. | `agentv.tool.index`, `agentv.generated_tool_call_id=true`, `agentv.source_event_id`, and warning `missing_tool_call_id` when AgentV generated an ID. | OTel and OpenInference both have tool-call identifiers but use different names. Emit both when useful and unambiguous. |
| Tool result/event | Prefer result data on the `execute_tool` span (`gen_ai.tool.call.result` and/or OpenInference `output.value`) when capture policy allows. | `gen_ai.tool.call.result`; `output.value`; `output.mime_type`. | If result content is large or redacted, put an artifact pointer in `artifacts.raw_evidence_dir` and set `agentv.tool.result_ref` on the span. | Do not create a separate canonical `tool_result` span unless the source emitted one. Derived `Message.toolCalls[].output` and transcript rows can still expose a paired result. |
| Final answer | The final assistant answer is the last relevant LLM output plus an envelope artifact pointer. | `gen_ai.output.messages` opt-in on the final LLM/root span; OpenInference `output.value`/`output.mime_type`. | `artifacts.answer_path`; optional root event `agentv.final_answer` with `agentv.artifact_path`. | Do not make `outputs/answer.md` canonical. It is derived from the final answer in spans or from replay projection. |
| Provider error | Set `status.code=ERROR` and message on the failed span and root span. Add exception event when details are available. | OTel exception event attributes `exception.type`, `exception.message`, `exception.stacktrace`; OpenInference reserves `exception.message`, `exception.stacktrace`, `exception.escaped`; span status `ERROR`. | `agentv.failure_stage`, `agentv.failure_reason_code`, envelope `conversion_warnings` when import is lossy rather than execution-failed. | A grader failure is score provenance, not provider execution error. Keep these separate. |
| Subagent/nested tool evidence | Nested root-like span under the calling tool span, e.g. `execute_tool runSubagent` -> `invoke_agent <subagent>`. Preserve imported parentage. | `gen_ai.operation.name=invoke_agent`; `gen_ai.agent.name`; `gen_ai.provider.name`; `openinference.span.kind=AGENT`; `session.id`. | `agentv.parent_tool_call_id`, `agentv.subagent=true` if needed for derived grader views. | VS Code/Copilot documents subagent invocations as nested `invoke_agent` spans under the parent `execute_tool runSubagent`; use that pattern when AgentV has enough evidence. |
| Score/evaluator provenance | Keep v1 score provenance in envelope `scores[]`. For OTLP export, also emit either root events or evaluator spans. | OTel GenAI evaluation event: `gen_ai.evaluation.name`, `gen_ai.evaluation.score.value`, `gen_ai.evaluation.score.label`, `gen_ai.evaluation.explanation`, `gen_ai.response.id`; OpenInference `openinference.span.kind=EVALUATOR`. | Existing `agentv.score` and `agentv.grader.*` root events remain compatibility output. Envelope `scores[].target_span_id`, `scores[].evidence.span_ids`, and `scores[].evidence.tool_call_ids` are the AgentV provenance contract. | Do not require `agentv.score` to import or score an external trace. Existing `inspect` OTLP import currently does; `.6` should remove that limitation for trace-only scoring. |
| Token usage | Put model token usage on the LLM span; aggregate usage can be repeated on root if useful for dashboards. | `gen_ai.usage.input_tokens`; `gen_ai.usage.output_tokens`; `gen_ai.usage.cache_read.input_tokens`; `gen_ai.usage.cache_creation.input_tokens`; `gen_ai.usage.reasoning.output_tokens`; OpenInference `llm.token_count.prompt`, `llm.token_count.completion`, `llm.token_count.total`, `llm.token_count.prompt_details.cache_read`, `llm.token_count.prompt_details.cache_write`, `llm.token_count.completion_details.reasoning`. | Envelope can carry no separate token summary; derive `TraceSummary`/timing artifacts from spans. | Use OTel GenAI attributes first because AgentV already exports them. Add OpenInference aliases only where an adapter/backend requires them. |
| Cost | Prefer OpenInference cost attributes when writing OpenInference-rich spans. Root aggregate cost may remain `agentv.trace.cost_usd` for compatibility. | OpenInference `llm.cost.prompt`, `llm.cost.completion`, `llm.cost.total`, `llm.cost.prompt_details.*`, `llm.cost.completion_details.*`. | `agentv.trace.cost_usd` compatibility attribute; result JSONL `cost_usd` remains derived/stable. | OTel GenAI cost attributes are not stable in current AgentV usage. Mark any new OTel cost key uncertain unless pinned to the current spec. |
| Duration/timing | Span start/end times are canonical. Derived `duration_ms` comes from `end_time_unix_nano - start_time_unix_nano`. | OTLP span `start_time_unix_nano`, `end_time_unix_nano`; optional `gen_ai.response.time_to_first_chunk` for streaming LLM latency. | `agentv.duration_inferred=true` and conversion warning when timing was inferred from source order. | Do not store a separate authored duration as canonical when spans have times. |
| Redaction/capture | Redaction is envelope policy plus omitted/filtered content attributes. | OTel GenAI docs mark message content attributes sensitive; VS Code/Copilot defaults content capture off and gates it via explicit settings/env. OpenInference supports privacy/masking concepts, but exact field-level masking keys should be pinned during implementation. | Envelope `capture.*`; span attributes `agentv.redaction.level`, `agentv.redaction.fields`, `agentv.content_ref` where useful. | Default should be metadata-only. Do not persist prompts, tool args/results, screenshots, or thinking blocks by default. |
| Conversion warnings | Not spans. Use envelope `conversion_warnings[]`. | No stable standard warning attribute found. | `code`, `severity`, `span_id`, `source_ref`, `message`, `details`. | Warnings are AgentV-owned because they explain adapter lossiness and generated IDs. |

## Fixture Plan

Golden fixtures should live under a trace-specific fixture directory, for example
`packages/core/test/evaluation/fixtures/execution-trace/` or
`examples/showcase/trace-evaluation/fixtures/execution-traces/`, with small raw-source
fixtures beside expected envelope JSON. Tests should compare semantic fields
rather than full timestamps when timestamps are generated.

Required fixture matrix:

| Fixture | Canonical span expectation | Derived `outputs/transcript.jsonl` | Derived `TraceSummary` | Compact grader view |
| --- | --- | --- | --- | --- |
| No-tool answer | Root `invoke_agent`, one `chat` span, final answer in LLM output/root artifact pointer. | User row plus final assistant row, no `tool_calls`. | `eventCount=0`, empty `toolCalls`, `llmCallCount=1`, no errors. | `tool-trajectory` sees empty tool sequence; `execution-metrics` sees one LLM call and no tool calls. |
| Simple tool | Root, one `chat`, one `execute_tool Read`, stable `gen_ai.tool.call.id` when present. | Assistant row has one `tool_calls` entry with input/output when capture allows. | `eventCount=1`, `{ Read: 1 }`, duration from tool span. | Tool event contains `position=0`, `tool_call_id`, args, status, span evidence. |
| Multi-tool order | Root, one or more `chat` spans, ordered tool spans by time/ordinal. | Preserve message order and tool order. | Counts each tool, preserves per-tool duration arrays. | In-order/exact assertions cite ordered span IDs and call IDs. |
| Missing ID | Tool span gets deterministic ID from eval/test/span position and warning `missing_tool_call_id`. | Transcript row includes generated ID only if current Message shape needs it; mark generated in metadata if exposed. | Same as simple tool. | Grader evidence can cite generated ID and warning. |
| Tool output | Tool result represented on tool span or artifact pointer under capture policy. | `tool_calls[].output` reconstructed from span output/pointer when allowed. | Tool count and duration unchanged. | Output-aware future graders read compact view from spans, not raw provider payload. |
| Provider error | Failed span and root have status `ERROR`; exception event where available. | Transcript includes messages emitted before failure plus final error assistant text only if current result path does that today. | `errorCount` increments only for failed tool/provider events represented in spans. | `execution-metrics` sees status/error evidence with `span_id`. |
| Token/cost/timing | LLM spans carry token attributes; cost on OpenInference cost attrs or compatibility root attr; span times canonical. | Transcript-level token/duration/cost fields match current artifact behavior. | `tokenUsage`, `costUsd`, `durationMs`, `startTime`, `endTime` derived from spans. | Metrics grader reads aggregate view derived from spans. |
| Redaction | No sensitive content attributes when `capture.content=metadata`; redaction fields/policy present. | Transcript has content omitted/redacted according to existing compatibility policy. | Counts and timing still derive from spans. | Tool names, call IDs, status, timing remain gradeable without content. |
| Nested/subagent | `execute_tool runSubagent` parent span with nested `invoke_agent <subagent>` and child spans. | Transcript may flatten to current Message[] compatibility shape, with parent refs in metadata. | Parent and nested tool calls count according to documented policy. | Compact view includes parent-child refs so skill/subagent graders can distinguish nested evidence. |
| Replay projection | Envelope derived from `replay-target-output.jsonl` and from live AgentV result produce equivalent `Message[]` projection. | Byte-stable transcript rows except for additive pointers that are explicitly documented. | Existing replay fixture summary behavior remains stable. | Replay target returns provider `Message[]`; graders run fresh using derived compact view. |

Baseline fixture assertions:

- Export envelope spans to official OTLP JSON and verify root/child IDs, parentage,
  GenAI attributes, and OpenInference span kinds.
- Import that OTLP JSON back into an envelope and regenerate `outputs/transcript.jsonl`.
- Round-trip opaque payloads containing both `snake_case` and `providerCamelKey`
  under message content, tool input, tool output, metadata, raw evidence, source
  metadata, and score evidence without key mutation.

## Implementation Decomposition

Minimal code slices:

1. `av-vwa.12` mixed-boundary serializer cleanup for touched files.
   Inventory `toSnakeCaseDeep`/`toCamelCaseDeep`; replace high-risk transcript,
   result, and trace/replay mixed-boundary serializers before the envelope writer
   starts carrying opaque payloads.

2. Core envelope model and serializers.
   Add a small module such as `packages/core/src/evaluation/trace-envelope.ts`
   with Zod schemas, `toTraceEnvelopeWire()`, `fromTraceEnvelopeWire()`, and
   explicit span/score/warning serializers. Keep `trace.ts` compatibility types
   as derived views.

3. AgentV result -> envelope conversion.
   Convert live `EvaluationResult`/provider `Message[]` into root/chat/tool spans,
   warnings, capture policy, artifacts, and score provenance. This is the core
   of `av-vwa.9`.

4. Envelope -> derived views.
   Implement projections from envelope spans to `Message[]`, `TraceSummary`,
   `TraceArtifact` if still needed, and `outputs/transcript.jsonl`. Existing
   artifacts should be produced by these
   projections once tests prove parity.

5. Artifact sidecar wiring.
   Write `outputs/execution-trace.json` or an equivalent sidecar and add an
   optional `execution_trace_path` pointer to per-test index entries only if the
   team accepts an additive index change. If not, write the sidecar inside the
   per-test artifact directory and leave index JSONL unchanged for the first PR.

6. OTLP import/export bridge.
   Reuse `packages/core/src/observability/otel-exporter.ts` and
   `otlp-json-file-exporter.ts` where possible, but move reusable span assembly
   below the exporter so envelope writing and `--otel-file` do not drift.

Sequencing:

- `av-vwa.12` should happen before `.9` or as the first PR inside `.9` if the
  same worker owns both. It is not optional once envelope code touches mixed
  AgentV/opaque payloads.
- `av-vwa.9` can start implementation after this spec. The first code worker
  should begin with `.12` serializer cleanup, then the `.9` envelope model.
- No new Beads are required before implementation starts. If the team wants
  parallelization, split `.9` into children for model/serializers, AgentV-run
  conversion, derived views, and artifact wiring; keep each child tied to the
  same v1 contract in this spec.

How related Beads consume this contract:

- `av-vwa.6`: Treat OTLP/OpenInference mapping as conformance/import/export
  around the envelope span body. Phoenix remains adapter-side. Remove the current
  trace-only import requirement that OTLP roots contain `agentv.score`.
- `av-vwa.7`: Graders consume an `AgentTrajectoryView` or equivalent compact view
  derived from envelope spans. Built-ins may keep legacy `Message[]` fallback for
  existing results.
- `av-vwa.8`: Pi importer becomes a source adapter into the envelope. Pi branch
  selection remains adapter-owned and records omitted branches/warnings in the
  envelope.
- `av-vwa.8.1`: Compact transcript/lifecycle importer becomes a source adapter
  into the envelope and records warnings for missing span-level data.
- `av-vwa.10`: Claude/Codex/Copilot importers should produce envelopes first,
  then derive the existing transcript JSONL and `Message[]` replay views.
- `av-vwa.11`: Replay from trace should project envelope spans to provider
  `Message[]`/target output. Keep PR #1374 target-output JSONL fixtures as a
  supported compatibility input and migration path.
- `av-vwa.5`: CLI/docs should present `outputs/transcript.jsonl` as a compatibility
  and replay view, not as the canonical trace format.

## Verification

Targeted commands for the implementation PR:

```bash
bun test packages/core/test/evaluation/trace-trajectory.test.ts \
  packages/core/test/evaluation/replay-fixtures.test.ts \
  packages/core/test/import/transcript-provider.test.ts

bun test packages/core/test/observability/otel-exporter.test.ts \
  packages/core/test/observability/file-exporters.test.ts \
  packages/core/test/observability/streaming-observer.test.ts

bun test apps/cli/test/commands/eval/artifact-writer.test.ts \
  apps/cli/test/commands/eval/output-messages.test.ts

bun run typecheck
bun run lint
```

Before declaring the branch ready, also run the repo gate:

```bash
bun run test
```

Red/green UAT scenario:

1. Red before this namespace change: run the replay showcase and confirm the run
   writes current result artifacts and `outputs/transcript.jsonl`, but the
   execution trace sidecar does not validate as canonical `agentv.trace.v1`.

   ```bash
   bun apps/cli/src/cli.ts eval \
     examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml \
     --target replay_coding_agent \
     --output /tmp/agentv-execution-trace-red
   ```

2. Green on the implementation branch: run the identical command with a new
   output directory. Confirm each test artifact has the execution trace sidecar, the
   sidecar validates against `agentv.trace.v1`, spans export to OTLP
   JSON, and regenerated transcript rows match the existing transcript artifact
   except for any documented additive pointer fields.

   ```bash
   bun apps/cli/src/cli.ts eval \
     examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml \
     --target replay_coding_agent \
     --output /tmp/agentv-execution-trace-green
   ```

Artifacts to inspect:

- `/tmp/agentv-execution-trace-green/index.jsonl`
- per-test `outputs/execution-trace.json`
- per-test `outputs/transcript.jsonl`
- per-test `outputs/answer.md`
- generated OTLP JSON, if the implementation writes an OTLP sidecar
- `examples/showcase/trace-evaluation/fixtures/replay-target-output.jsonl`
  remains unchanged unless a migration is explicitly accepted

Stability proof:

- Existing result JSONL parses with `parseJsonlResults()`.
- Existing replay fixture tests pass unchanged.
- Existing `outputs/transcript.jsonl` test expectations pass or receive a narrow
  additive update with migration notes.
- `TraceSummary` values derived from the envelope match values derived from
  current `buildTraceFromMessages()` for no-tool, simple-tool, multi-tool,
  error, token, cost, and timing fixtures.

## Open Questions

Recommended defaults are included so implementation is not blocked.

1. Should the first `.9` PR add `execution_trace_path` to `index.jsonl`?
   Recommended default: write the sidecar in each per-test artifact directory
   first and defer the index pointer unless the dashboard/CLI needs discovery in
   the same PR.

2. Should AgentV-generated tool spans be parented to the chat span or root agent
   span?
   Recommended default: parent to the requesting chat span when AgentV can prove
   that relationship from `Message.toolCalls`; preserve imported source parentage
   for external OTLP.

3. Should score provenance be root events or evaluator spans in OTLP export?
   Recommended default: keep envelope `scores[]` authoritative; emit current
   `agentv.grader.*` root events for compatibility; add
   `gen_ai.evaluation.result` events or OpenInference `EVALUATOR` spans only
   when a consumer needs them.

4. What exact OpenInference masking/redaction attributes should AgentV emit?
   Recommended default: keep redaction policy in the AgentV envelope and avoid
   claiming OpenInference masking keys until implementation pins the current
   OpenInference privacy spec.

## Sources

Local AgentV inputs read for this spec:

- `docs/plans/trace-evaluation-architecture.md`
- `docs/adr/2026-06-11-phoenix-observability-adapter.md`
- `packages/core/src/evaluation/trace.ts`
- `packages/core/src/observability/otel-exporter.ts`
- `packages/core/src/observability/otlp-json-file-exporter.ts`
- `packages/core/src/import/types.ts`
- `packages/core/src/import/claude-parser.ts`
- `packages/core/src/import/codex-parser.ts`
- `packages/core/src/evaluation/providers/copilot-log-parser.ts`
- `packages/core/src/evaluation/replay-fixtures.ts`
- `apps/cli/src/commands/eval/artifact-writer.ts`
- `apps/cli/src/commands/eval/run-eval.ts`
- Relevant tests under `packages/core/test/evaluation/`,
  `packages/core/test/import/`, `packages/core/test/observability/`, and
  `apps/cli/test/commands/eval/`

External primary references used to pin names:

- OpenTelemetry GenAI semantic conventions repository:
  https://github.com/open-telemetry/semantic-conventions-genai
- OpenTelemetry GenAI inference span report:
  https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/reference/reports/inference-span.md
- OpenTelemetry GenAI execute-tool span report:
  https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/reference/reports/execute-tool-span.md
- OpenTelemetry GenAI invoke-agent reports:
  https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/reference/reports/invoke-agent-internal-span.md
  and
  https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/reference/reports/invoke-agent-client-span.md
- OpenTelemetry GenAI evaluation result event report:
  https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/reference/reports/gen-ai-evaluation-result-event.md
- OpenInference specification:
  https://arize-ai.github.io/openinference/spec/
- OpenInference semantic conventions:
  https://arize-ai.github.io/openinference/spec/semantic_conventions.html
- VS Code Copilot agent monitoring with OpenTelemetry:
  https://code.visualstudio.com/docs/agents/guides/monitoring-agents
- Phoenix evaluation/annotation docs:
  https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/llm-evaluations
- Braintrust tracing import/export docs:
  https://www.braintrust.dev/docs/instrument/advanced-tracing
- LangSmith feedback data format:
  https://docs.langchain.com/langsmith/feedback-data-format
