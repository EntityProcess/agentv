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

AgentV exports evaluation traces through generic OpenTelemetry/OTLP plumbing and is adding a trace artifact contract for post-hoc trace evaluation. A focused follow-up proposed adding a Phoenix OTel backend preset for `--otel-backend phoenix`, but that raised a scope concern: Phoenix project routing, collector endpoint conventions, API keys, dataset concepts, and experiment behavior are backend-specific.

AgentV's architecture principles prefer a lightweight core with extension points and adapters. Built-ins should be universal primitives that most users compose. Backend-specific observability integrations should not make AgentV core behave like a hosted trace or experiment platform.

Relevant existing seams already point in this direction:

- Provider and grader registries support narrow registration points.
- `.agentv/providers/`, `.agentv/assertions/`, and `.agentv/graders/` use convention-based local discovery instead of a broad plugin host.
- Earlier Phoenix adapter experiments kept Phoenix-specific behavior outside core and reported unsupported mappings explicitly. Those experiments are not the supported product path for AgentV completed runs or transcripts.
- The trace evaluation plan requires generic OTLP/OpenInference mapping without Phoenix-specific assumptions in core.

## Decision

Do not add direct Phoenix export or Phoenix-specific OTel backend preset logic to `packages/core`.

AgentV core should own:

- generic OTLP/HTTP export configuration;
- OTLP JSON file export;
- trace artifact types and boundary conversion;
- generic OTLP/OpenInference import/export mapping where it is backend-neutral;
- small registry/discovery primitives for extension points.

Phoenix integration should live outside core behind a narrow local adapter or
resolver boundary when needed. No maintained workspace package currently owns
that boundary. The first implementation does not need package loading or package
naming; a local resolver module is enough. Such a custom boundary may expose:

- a Phoenix OTel backend resolver;
- Phoenix/OpenInference span-kind mapping;
- link-out helpers for externally emitted trace/session correlation;
- explicit unsupported/lossy mapping reports.

## Minimal extension seam

Historical note: this ADR originally considered a first-class `--otel-backend phoenix`
ergonomics path. That must not be used to make Phoenix a Dashboard dependency or
an AgentV-owned artifact destination. Any future Phoenix work should be framed as
link-out correlation for externally emitted spans.

A resolver should be approximately:

```ts
export interface OtelBackendResolver {
  readonly name: string;
  resolve(context: {
    env: Record<string, string | undefined>;
    cwd: string;
  }): {
    endpoint: string;
    headers?: Record<string, string>;
    warnings?: string[];
  };
}
```

Registration/discovery should remain boring and local-first. In this ADR, "plugin" should not imply a coding-agent plugin or package marketplace; this is only a backend resolver module seam:

- support explicit TypeScript registration for programmatic callers;
- optionally discover Node-loadable `.agentv/otel-backends/*.mjs` or `*.js`, where the filename is the backend name;
- keep `execution.otel_backend: <name>` and `--otel-backend <name>` as the user-facing selectors;
- do not add package names, package auto-installation, a remote marketplace, trust prompts, or a general-purpose plugin host for this need.

The earlier prototype exposed a resolver so users could opt in from project config
or a local `.agentv/otel-backends/phoenix.mjs` file. Treat that as a
custom/legacy path, not as the supported AgentV-to-Phoenix product boundary.

## Migration path for Phoenix

1. Keep current generic OTLP configuration working:
   - `OTEL_EXPORTER_OTLP_ENDPOINT`
   - `OTEL_EXPORTER_OTLP_HEADERS`
   - `--otel-file` for offline OTLP JSON export
2. Add a tiny backend resolver seam only if ergonomic backend names are needed.
3. Keep any custom Phoenix endpoint/header/project routing outside core and outside the supported AgentV artifact path.
4. Keep Phoenix out of Dashboard runtime fetch paths; use safe external links instead.
5. Consider moving existing vendor-specific core presets to the same resolver model later, but do not couple that cleanup to the Phoenix decision unless the implementation already touches the preset registry.

## Consequences

Positive:

- Keeps core aligned with AgentV's lightweight-core and composition principles.
- Prevents Phoenix concepts from leaking into the generic trace model.
- Gives Phoenix users a link-out correlation path without blocking generic OTLP users.
- Reuses AgentV's existing pattern of narrow registries and convention-based local discovery.

Negative:

- Any maintained Phoenix OTel resolver must stay outside the zero-infra Dashboard path.
- Existing vendor presets in core remain an architectural inconsistency until migrated.
- Package-level resolver sharing may need a future decision if many backend adapters emerge.

## Tracker impact

- `av-vwa.6` remains valid only for generic trace artifacts and OTLP/OpenInference shapes. Phoenix-specific link-out metadata must not become AgentV-to-Phoenix artifact projection or Dashboard runtime fetching.
- `av-vwa.6.1` is superseded as a Phoenix preset/resolver task unless it is reframed under the read-only external-trace correlation boundary.

## Open questions

- Should the existing `langfuse`, `braintrust`, and `confident` core presets migrate to resolver modules in a follow-up cleanup?
- Should resolver loading stay limited to local Node-loadable `.agentv/otel-backends/*.mjs`/`*.js`, or should `agentv.config.ts` support direct resolver imports first?
- What exact Phoenix project-routing headers should the adapter emit across local Phoenix and hosted Phoenix variants?
