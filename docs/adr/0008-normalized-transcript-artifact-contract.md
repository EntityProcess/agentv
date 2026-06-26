# 8. Normalized transcript artifact contract

Date: 2026-06-26

## Status

Accepted

## Context

AgentV run bundles need a transcript contract that works across native coding
agents such as Codex, Claude Code, OpenCode, Gemini, Cursor, Copilot, and Pi.
Those tools do not share a native transcript schema:

- Codex stores native rollout JSONL under `CODEX_HOME` / `~/.codex`, with
  response items and side-band events such as tool execution and token counts.
- Claude Code-style harnesses store native JSONL with provider messages,
  `tool_use` blocks, `tool_result` blocks, parent UUID chains, and harness
  metadata.
- Pi sessions are JSONL trees with `id` / `parentId`, so an active branch must
  be selected before scoring or replay.
- Entire checkpoints may copy native transcript bytes into `full.jsonl`, while
  Entire compact `transcript.jsonl` projects those bytes into a cross-agent
  conversation transcript.
- Vercel `agent-eval` / `next-evals-oss` uses a useful raw-plus-normalized file
  split: `transcript-raw.jsonl` preserves native output, while
  `transcript.json` stores parsed events and summary data.

AgentV already has a result bundle and metrics boundary. Derived behavior
summaries such as tool-call counts, file lists, shell commands, errors, token
totals, and timing belong in result/metrics artifacts, not inside the portable
transcript contract. Per the wire-format convention, all on-disk JSON/JSONL
fields use `snake_case`.

The transcript artifact must serve three jobs:

- preserve native evidence for debugging and parser improvements;
- provide a portable, human-readable, replayable transcript for review and
  grading;
- support dashboard and evaluator queries without making a low-level event log
  the only transcript.

## Decision

AgentV run bundles use a raw-plus-normalized transcript split:

```text
transcript-raw.jsonl   # byte-preserving native provider/harness transcript copy
transcript.jsonl       # AgentV-normalized conversation transcript
metrics.json           # derived behavior, timing, and observability summaries
```

`transcript-raw.jsonl` is copied from the agent or harness-native source, such
as `.codex`, `.claude`, or an equivalent provider session file. AgentV does not
normalize this file beyond storing it at a stable artifact path. If the source
is already an Entire `full.jsonl` checkpoint copy, AgentV treats it as native
session evidence because the file contents remain provider-shaped.

`transcript.jsonl` is the portable transcript contract. It is line-oriented
JSONL, versioned per line, and shaped as conversation turns. A tool call and its
result are joined into the same `tool_use` content block when the result is
available:

```json
{"v":1,"agent":"codex","model":"gpt-5.1-codex","type":"assistant","ts":"2026-06-26T12:00:02.000Z","id":"turn_2","input_tokens":1200,"output_tokens":180,"content":[{"type":"text","text":"Running the test suite."},{"type":"tool_use","id":"call_1","name":"exec_command","input":{"cmd":"bun test","workdir":"/repo"},"result":{"status":"success","output":"42 tests passed","duration_ms":1834}}]}
```

The minimal normalized line contract is:

| Field | Required | Meaning |
| --- | --- | --- |
| `v` | yes | transcript schema version |
| `agent` | yes | normalized agent/harness id such as `codex` or `claude-code` |
| `type` | yes | `system`, `user`, or `assistant` |
| `content` | yes | ordered content blocks for this turn |
| `ts` | no | source timestamp when available |
| `id` | no | stable source or generated turn/message id |
| `model` | no | model id when available |
| `input_tokens` | no | input tokens attributable to this assistant turn |
| `output_tokens` | no | output tokens attributable to this assistant turn |
| `raw_refs` | no | source-line references into `transcript-raw.jsonl` |

The minimal content block contract is:

| Block | Required fields | Optional fields |
| --- | --- | --- |
| `text` | `text` | `raw_refs` |
| `tool_use` | `id`, `name`, `input` | `result`, `raw_refs`, `metadata` |
| `image` | `source` | `mime_type`, `metadata` |
| `thinking` | `text` | `raw_refs` |

Tool result status is normalized to `success`, `error`, `cancelled`, or
`unknown`. Provider-specific payloads may be retained under `metadata` only when
they are needed for replay or parser forensics; high-cardinality analytics
belong in `metrics.json`.

Run indexes and manifests should expose transcript sidecars through explicit
path fields:

```json
{"transcript_path":"./transcript.jsonl","transcript_raw_path":"./transcript-raw.jsonl","metrics_path":"./metrics.json"}
```

Do not use `artifact_pointers` as the discovery path for ordinary per-run
transcript sidecars. `artifact_pointers` remains an offload indirection for large
detached payload bytes.

AgentV may derive additional event-oriented projections from `transcript.jsonl`
for Dashboard queries, tool-trajectory scoring, OpenTelemetry/OpenInference
mapping, or export adapters. Those projections are secondary indexes. They do
not replace `transcript.jsonl` as the portable transcript contract.

## Consequences

- Human review, replay, and grading can consume one stable normalized transcript
  instead of parsing Codex, Claude, Pi, and other provider formats directly.
- Tool call scoring avoids joining separate `tool_call` and `tool_result` events
  for the common completed-action case because the result sits on the matching
  `tool_use` block.
- Raw native transcript bytes remain available for debugging, parser fixes, and
  audit without leaking provider-specific schema into the portable contract.
- Dashboard and trajectory evaluators can still get event-table access by
  deriving an event index from `transcript.jsonl`.
- Derived behavior summaries stay in `metrics.json`, avoiding Vercel-style
  `o11y` blobs on the transcript itself.
- Public transcript fields follow AgentV's `snake_case` wire-format convention.

## Alternatives Considered

- **Use Vercel `agent-eval`'s event object as the primary normalized
  transcript.** Rejected as the primary contract. It is excellent for event
  queries and public benchmark bundle ergonomics, but it splits a single tool
  action across `tool_call` and `tool_result` records. AgentV can derive this
  shape when needed without making it the durable human transcript.
- **Use Entire compact `transcript.jsonl` unchanged.** Rejected as a literal
  dependency but accepted as the closest shape precedent. AgentV should keep the
  joined `tool_use.result` model and line-oriented JSONL, while using AgentV
  field names, model metadata, raw references, and metrics boundaries.
- **Store only native raw transcripts.** Rejected. Native streams are necessary
  evidence, but they are provider-specific and expensive for evaluators,
  dashboards, and reviewers to consume consistently.
- **Put behavior summaries in `transcript.jsonl`.** Rejected. Counts, command
  lists, files read/modified, errors, timing, and token rollups are derived
  metrics and belong in `metrics.json` or result metadata.
- **Make OpenTelemetry/Phoenix spans the transcript contract.** Rejected.
  OpenTelemetry/OpenInference mapping is valuable as an adapter/export
  projection, but AgentV-owned run bundles remain the source of truth and do not
  project completed transcripts into Phoenix.

## Non-Goals

- Implementing transcript parsers or migrating current artifact writers in this
  ADR.
- Defining a public redaction or dataset publication workflow.
- Replacing trace spans, result rows, grading artifacts, or metrics artifacts.
- Requiring a hosted database, Phoenix, OpenTelemetry collector, or external
  dashboard runtime to inspect local run transcripts.
