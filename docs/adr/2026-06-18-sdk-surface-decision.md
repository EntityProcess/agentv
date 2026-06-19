# ADR: Replace @agentv/eval with @agentv/sdk as the public TypeScript SDK

Date: 2026-06-18

Status: Accepted

Supersedes: the earlier 2026-06-18 decision in this file that rejected a
separate `@agentv/sdk` package.

## Context

AgentV has two distinct package responsibilities:

- `@agentv/core` owns evaluation execution: the runner, orchestrator internals,
  provider plumbing, artifact writing, `evaluate()`, and export integrations.
- The lightweight TypeScript SDK owns authoring helpers for custom graders,
  custom assertions, prompt templates, target-client access, and the relevant
  types those helpers need.

The previous decision rejected a new `@agentv/sdk` package because a separate
authoring facade risked adding another vocabulary layer beside YAML and
`evaluate()`. That concern still applies to broad Braintrust-style helper
catalogs, but it does not justify keeping the public helper package named
`@agentv/eval`.

The public package surface is still early, and the long-term naming risk of
`@agentv/eval` is now judged higher than a controlled package rename. WTG
research for the SDK-DX work showed that SDK package naming and ergonomic helper
entry points are industry-consistent, as long as AgentV keeps the helpers
native to its YAML/runtime contracts instead of copying another framework's
domain model.

## Decision

Rename the lightweight TypeScript helper package to `@agentv/sdk` and rehome
its implementation under `packages/sdk`.

`@agentv/sdk` replaces `@agentv/eval` as the public package for:

- `defineAssertion`
- `defineCodeGrader`
- `definePromptTemplate`
- target-client helpers such as `createTargetClient`
- Zod re-export for typed grader config
- narrow SDK-facing types for grader, assertion, prompt-template, trace, and
  message payloads

Repo docs, examples, scaffold templates, tests, and skills should teach
`@agentv/sdk` as the primary package.

## Compatibility Policy

Prefer hard convergence while the surface is early. If a package, field, flag,
or wire name has not shipped to real external consumers, remove the old name
instead of carrying aliases.

For this package rename, npm evidence changes the compatibility choice:

- `@agentv/eval` has already been published.
- the npm downloads API reported 6,131 downloads for `@agentv/eval` from
  2026-05-19 through 2026-06-17.
- `@agentv/sdk` is not yet published at the time of this decision.

Therefore `@agentv/eval` remains only as a thin deprecated compatibility
package that re-exports `@agentv/sdk` for existing consumers. It should not be
used by new docs, examples, scaffolds, or skills except when explaining the
migration.

Future removal of `@agentv/eval` requires an explicit release/migration
decision. The compatibility package must not grow new API surface.

## Non-Goals

Do not move these responsibilities into `@agentv/sdk`:

- `evaluate()` or programmatic run execution
- orchestrator internals
- provider execution and target orchestration
- artifact writing, JSONL result persistence, or dashboard result formats
- Opik, Phoenix, Langfuse, or other observability/export implementations
- Braintrust/DeepEval clone APIs or broad helper catalogs

If SDK helpers are added later, they must remain AgentV-native and lower to the
canonical YAML/runtime contracts. Broad ergonomic work belongs in separate
tracked tasks.

## Consequences

Positive:

- public package naming matches user expectations for a lightweight SDK
- `@agentv/core` remains the runner/engine/artifact implementation
- the old published package can guide existing consumers to the new name
  without teaching the old name as the primary API

Negative:

- one temporary compatibility package remains until a later removal decision
- release scripts and examples need to carry both package paths during the
  migration window

## Tracker Impact

- `av-bv4.11`: this ADR supersedes the previous no-new-sdk decision and records
  the new package-boundary decision.
- `av-bv4.12`: implementation should move the SDK surface to `packages/sdk` /
  `@agentv/sdk`, keep `@agentv/eval` only as a deprecated shim because it was
  already published, and update repo references so the old name is not taught as
  primary.
