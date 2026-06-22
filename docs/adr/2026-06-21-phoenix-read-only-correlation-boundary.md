# ADR: Keep Phoenix read-only at the AgentV artifact boundary

Date: 2026-06-21

Status: Accepted

## Context

AgentV's canonical inspection path is local and Git-backed: completed run bundles,
`index.jsonl`, trace sidecars, transcripts, reports, and Dashboard read models.
Earlier Phoenix integration language described Phoenix as a shared UI or as a
place to project AgentV datasets, experiments, completed runs, traces, or
transcripts. That expands Phoenix from an adjacent tool into an owner of AgentV
state.

The 2026-06-20 product decision narrowed the boundary. Phoenix can remain useful
when Codex, Arize, or another hook already emitted spans independently, but
AgentV should not write its completed artifacts into Phoenix or make Phoenix part
of the zero-infra local path.

## Decision

AgentV does not export or project completed AgentV runs, traces, transcripts,
datasets, experiments, or indexes into Phoenix.

AgentV-owned run artifacts and the local Dashboard remain the supported
zero-infra inspection path for AgentV run, trace, session, transcript, and
comparison data.

Phoenix integration, when present, is link-out correlation:

- AgentV artifacts may carry safe `external_trace` metadata that identifies an
  external Phoenix trace or session.
- Dashboard may expose an `Open in Phoenix` link when that metadata includes a
  safe UI URL.
- Phoenix does not own AgentV transcript, index, run, dataset, experiment, or
  storage state.
- Dashboard must not require the `px` CLI at runtime.
- Dashboard must not proxy Phoenix GraphQL/REST or duplicate Phoenix sessions,
  traces, or spans in AgentV UI.
- Dashboard must not query Phoenix database tables directly.
- The local Dashboard path must work without any Phoenix runtime dependency.

AgentV transcript artifacts are not Phoenix-native conversation inputs. A
model-call span may include cumulative input messages, so converting Phoenix span
inputs into AgentV transcripts would duplicate prior turns and lose AgentV's
artifact semantics.

## Consequences

Positive:

- Keeps AgentV's source of truth portable across local development and CI.
- Avoids a second write path for run, transcript, trace, and index state.
- Keeps Phoenix useful as an external viewer without coupling Dashboard to a
  Phoenix runtime, database schema, API, or CLI.

Negative:

- Phoenix will not be the default shared UI for AgentV-owned run results.
- Teams that want Phoenix views must rely on independently emitted traces or a
  separate custom workflow outside the supported AgentV artifact path.

## Follow-up

`av-2il.5` removes the Dashboard Phoenix runtime fetch path and keeps only a
link-out affordance for externally emitted sessions that are already referenced
by safe `external_trace` metadata. Future work must not add AgentV-to-Phoenix
export/projection, direct Phoenix database access, `px` runtime requirements,
Phoenix-owned indexes, Phoenix transcript ingestion, or embedded Phoenix
session/span UI.
