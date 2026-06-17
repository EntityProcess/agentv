# ADR: Keep Phoenix observability integration out of core

Date: 2026-06-11

Status: Proposed

## Context

AgentV exports evaluation traces through generic OpenTelemetry/OTLP plumbing and is adding a derived trajectory contract for post-hoc trace evaluation. A focused follow-up proposed adding a Phoenix OTel backend preset for `--otel-backend phoenix`, but that raised a scope concern: Phoenix project routing, collector endpoint conventions, API keys, dataset concepts, and experiment behavior are backend-specific.

AgentV's architecture principles prefer a lightweight core with extension points and adapters. Built-ins should be universal primitives that most users compose. Backend-specific observability integrations should not make AgentV core behave like a hosted trace or experiment platform.

Relevant existing seams already point in this direction:

- Provider and grader registries support narrow registration points.
- `.agentv/providers/`, `.agentv/assertions/`, and `.agentv/graders/` use convention-based local discovery instead of a broad plugin host.
- `packages/phoenix-adapter/` already keeps Phoenix dataset and experiment behavior outside core and reports unsupported mappings explicitly.
- The trace evaluation plan requires generic OTLP/OpenInference mapping without Phoenix-specific assumptions in core.

## Decision

Do not add direct Phoenix export or Phoenix-specific OTel backend preset logic to `packages/core`.

AgentV core should own:

- generic OTLP/HTTP export configuration;
- OTLP JSON file export;
- derived trajectory types and wire conversion;
- generic OTLP/OpenInference import/export mapping where it is backend-neutral;
- small registry/discovery primitives for extension points.

Phoenix integration should live outside core behind an adapter boundary, currently `packages/phoenix-adapter/`. The first implementation does not need package loading or package naming; a local resolver module is enough. The adapter boundary may expose:

- a Phoenix OTel backend resolver;
- Phoenix/OpenInference span-kind mapping;
- Phoenix trace import/export helpers;
- Phoenix dataset and experiment helpers;
- explicit unsupported/lossy mapping reports.

## Minimal extension seam

If `--otel-backend phoenix` needs first-class ergonomics, add the smallest observability backend extension seam rather than hard-coding Phoenix in core.

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

The Phoenix adapter can then expose a resolver, for example `phoenixOtelBackend`, and users can opt in from project config or a local `.agentv/otel-backends/phoenix.mjs` file. Reusable npm packages can come later only if repeated project-local resolver files become real friction.

## Migration path for Phoenix

1. Keep current generic OTLP configuration working:
   - `OTEL_EXPORTER_OTLP_ENDPOINT`
   - `OTEL_EXPORTER_OTLP_HEADERS`
   - `--otel-file` for offline OTLP JSON export
2. Add a tiny backend resolver seam only if ergonomic backend names are needed.
3. Implement Phoenix endpoint/header/project routing in the Phoenix adapter boundary, not in core.
4. Keep Phoenix dataset, experiment, and trace-source behavior in `packages/phoenix-adapter/`.
5. Consider moving existing vendor-specific core presets to the same resolver model later, but do not couple that cleanup to the Phoenix decision unless the implementation already touches the preset registry.

## Consequences

Positive:

- Keeps core aligned with AgentV's lightweight-core and composition principles.
- Prevents Phoenix concepts from leaking into the generic trace model.
- Gives Phoenix users an ergonomic path without blocking generic OTLP users.
- Reuses AgentV's existing pattern of narrow registries and convention-based local discovery.

Negative:

- `--otel-backend phoenix` requires a small extension seam or adapter shim instead of a one-line core preset.
- Existing vendor presets in core remain an architectural inconsistency until migrated.
- Package-level resolver sharing may need a future decision if many backend adapters emerge.

## Tracker impact

- `av-vwa.6` remains valid: core should map derived trajectories to and from generic OTLP/OpenInference shapes, while Phoenix-specific dataset, experiment, project, and span-kind behavior stays in adapter space.
- `av-vwa.6.1` should be revised from adding a Phoenix preset in core to adding the minimal observability backend extension seam plus a Phoenix resolver in the Phoenix adapter. If the extension seam is not approved, defer the bead and document generic OTLP environment-variable configuration for Phoenix instead.

## Open questions

- Should the existing `langfuse`, `braintrust`, and `confident` core presets migrate to resolver modules in a follow-up cleanup?
- Should resolver loading stay limited to local Node-loadable `.agentv/otel-backends/*.mjs`/`*.js`, or should `agentv.config.ts` support direct resolver imports first?
- What exact Phoenix project-routing headers should the adapter emit across local Phoenix and hosted Phoenix variants?
