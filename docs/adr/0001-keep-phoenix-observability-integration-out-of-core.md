# 1. Keep Phoenix observability integration out of core

Date: 2026-06-11

## Status

Superseded

Superseded in part by [5. Keep Phoenix read-only at the AgentV artifact boundary](0005-keep-phoenix-read-only-at-agentv-artifact-boundary.md).

This ADR remains useful for the narrower point that Phoenix-specific behavior
does not belong in `packages/core`. Its earlier allowance for Phoenix dataset,
experiment, trace import/export helpers is superseded: Phoenix is now link-out
correlation for externally emitted traces, not an AgentV artifact projection
target or Dashboard Phoenix-runtime dependency.

## Context

AgentV previously experimented with exporting evaluation traces through generic
OpenTelemetry/OTLP plumbing. A focused follow-up proposed adding a Phoenix OTel
backend preset, but that raised a scope concern: Phoenix project routing,
collector endpoint conventions, API keys, dataset concepts, and experiment
behavior are backend-specific. The later product boundary tightened this
further: AgentV should not synthesize OTLP from completed eval transcripts as
the primary observability path. The system under test, provider wrapper, or
runtime hook should emit OpenTelemetry/OpenInference spans directly when an
external trace backend is needed.

AgentV's architecture principles prefer a lightweight core with extension points and adapters. Built-ins should be universal primitives that most users compose. Backend-specific observability integrations should not make AgentV core behave like a hosted trace or experiment platform.

Relevant existing seams already point in this direction:

- Provider and grader registries support narrow registration points.
- `.agentv/providers/`, `.agentv/assertions/`, and `.agentv/graders/` use convention-based local discovery instead of a broad plugin host.
- Earlier Phoenix adapter experiments kept Phoenix-specific behavior outside core and reported unsupported mappings explicitly. Those experiments are not the supported product path for AgentV completed runs or transcripts.
- Trace evaluation can still import or receive external OTLP/OpenInference-style
  traces through a separate capability, but AgentV run bundles remain the
  canonical eval artifact.

## Decision

Do not add direct Phoenix export, Phoenix-specific OTel backend preset logic, or
AgentV transcript-to-OTLP export as a core eval-run path.

AgentV core should own:

- trace artifact types and boundary conversion;
- generic OTLP/OpenInference import or receive mapping where it is backend-neutral
  and separate from eval-run export;
- small registry/discovery primitives for extension points.

Phoenix integration should live outside core behind narrow correlation metadata
when needed. Such a boundary may expose:

- link-out helpers for externally emitted trace/session correlation;
- explicit unsupported/lossy mapping reports for imported or received traces.

## Minimal extension seam

Historical note: this ADR originally considered first-class backend resolver
ergonomics for Phoenix. That path has been removed from AgentV's eval-run CLI and
project config surface. Any future Phoenix work should be framed as link-out
correlation for externally emitted spans or as separate trace import/evaluation,
not as AgentV-owned completed-run export.

## Migration path for Phoenix

1. Remove AgentV eval-run OTLP export flags and project config fields.
2. Keep custom Phoenix endpoint/header/project routing in the system under test,
   provider wrapper, or external instrumentation layer.
3. Keep Phoenix out of Dashboard runtime fetch paths; use safe external links
   through `external_trace` metadata instead.
4. Treat import or evaluation of externally emitted OTLP/OpenInference traces as
   separate from completed AgentV run export.

## Consequences

Positive:

- Keeps core aligned with AgentV's lightweight-core and composition principles.
- Prevents Phoenix concepts from leaking into the generic trace model.
- Gives Phoenix users a link-out correlation path without making AgentV an OTLP exporter.
- Reuses AgentV's existing pattern of narrow registries and convention-based local discovery.

Negative:

- Users who want external trace inspection must instrument their system under
  test, provider wrapper, or runtime hook directly.
- Trace import/evaluation remains a separate capability rather than an eval-run
  export flag.

## Tracker impact

- `av-vwa.6` remains valid only for generic trace artifacts and OTLP/OpenInference shapes. Phoenix-specific link-out metadata must not become AgentV-to-Phoenix artifact projection or Dashboard runtime fetching.
- `av-vwa.6.1` is superseded as a Phoenix preset/resolver task unless it is reframed under the read-only external-trace correlation boundary.

## Open questions

- What exact metadata should each provider wrapper expose so AgentV can attach
  safe `external_trace` correlation without leaking credentials?
- Which external OTLP/OpenInference trace import shapes should AgentV evaluate
  first?
