# 19. Promptfoo-first provider authoring and export boundary

Date: 2026-07-07

## Status

Accepted (2026-07-07). Supersedes the target/provider authoring portions of
[ADR 0016](0016-promptfoo-superset-eval-authoring-contract.md),
[ADR 0017](0017-output-artifact-and-workspace-resolver-contract.md), and
[ADR 0018](0018-coding-agent-target-runtime-contract.md). It does not rename
existing run-bundle artifact fields such as `target` or Dashboard target facets;
those remain a separate artifact migration decision.

Tracked by Beads `av-fdco`, `av-ctfu`, `av-uttb`, and `av-lbcv`.

## Context

AgentV originally kept `targets` as the canonical public system-under-test axis
and treated Promptfoo `providers` as reference evidence. That made AgentV's
internal identity model explicit, but it also created a large avoidable
translation gap against the incumbent eval authoring surface we want users and
agents to recognize.

Promptfoo already has broad ecosystem familiarity for normal eval matrices:
`providers`, `prompts`, `tests`, `vars`, `assert`, `env`, `extensions`, provider
option objects, package providers, and colon-delimited provider ids such as
`openai:responses:gpt-5.4`. AgentV's durable product difference is not a
different name for the matrix axis. It is repo-native environment setup,
agent-native providers, portable run artifacts, and the local Dashboard.

## Decision

AgentV authored eval YAML is Promptfoo-first by default. Public systems under
test are authored under top-level `providers`, not `targets`.

AgentV intentionally diverges from directly runnable Promptfoo YAML only for
three authoring categories:

1. **`environment`**
   AgentV owns declarative repo/testbed setup, fixtures, services, workdir,
   host/Docker lifecycle, and provenance. Promptfoo has lifecycle `extensions`,
   but it has no typed environment primitive.

2. **AgentV refs**
   AgentV may support repo-native references that are more ergonomic than raw
   Promptfoo config. Export must inline, copy, or rewrite supported refs into
   Promptfoo-readable `file://` or generated files where possible.

3. **Built-in AgentV providers**
   AgentV-native provider ids such as `agentv:codex-cli` are first-class
   ergonomic built-ins. They are not directly Promptfoo-runnable ids. Promptfoo
   compatibility for those providers is by export/transpile into a
   Promptfoo-readable provider reference.

All other public eval authoring should either match Promptfoo's shape or be
intentionally rejected rather than expanded into a parallel AgentV surface.

## Provider Contract

Provider entries use Promptfoo-compatible shapes:

```yaml
providers:
  - openai:responses:gpt-5.4
  - id: openai:codex-sdk:gpt-5.5
    label: codex-sdk
  - id: agentv:codex-cli
    label: codex-cli
    config:
      command: codex
      model: gpt-5.5
```

Field meanings:

| Field | Meaning |
| --- | --- |
| `id` | Backend/spec string. It may contain colons and is interpreted by the provider resolver. |
| `label` | Stable AgentV selection/result identity. Defaults to `id` when omitted. |
| `config` | Provider-specific configuration. |
| `env`, `prompts`, `transform`, `delay`, `inputs` | Promptfoo-compatible provider option fields. |

`providers[].id` is not a safe artifact path segment. Artifact writers should
continue using existing sanitized target/result identity fields unless a
separate artifact migration is accepted.

Duplicate `label` values are invalid because label is the AgentV selection and
result identity. Duplicate `id` values may be valid when labels differ, such as
two configurations of the same backend.

## Promptfoo Export Boundary

Direct compatibility applies to Promptfoo-native declarations. Full Promptfoo
compatibility for AgentV-native YAML is provided by `agentv export promptfoo`.

The exporter lowers supported AgentV-native provider ids into Promptfoo-readable
providers, preferring cross-platform TypeScript or package providers over shell
wrappers:

```yaml
providers:
  - id: file://.agentv/generated/promptfoo/providers/codex-cli-provider.ts:callApi
    label: codex-cli
    config:
      command: codex
      model: gpt-5.5
```

When a published provider package exists and is installed, export may also emit
complete Promptfoo package provider ids:

```yaml
providers:
  - id: package:@agentv/promptfoo-providers:CodexCliProvider
    label: codex-cli
```

Promptfoo package provider ids must include the exported class/function segment
after the final colon. A bare `package:@agentv/promptfoo-providers/codex-cli`
is invalid at provider-load time.

## Environment Export Boundary

Promptfoo export may support a filesystem-isolated host subset of
`environment`. In that subset, AgentV can transpile environment setup into
Promptfoo `extensions` and generated provider configuration:

- a generated `beforeAll`/`beforeEach` extension materializes the isolated
  workspace and records the resolved workdir in a generated variable or
  metadata field;
- exported providers receive that workdir through their `config` or vars;
- generated files keep the setup logic visible in the exported Promptfoo
  project;
- the exporter records diagnostics explaining which AgentV environment fields
  were lowered.

Docker environments are not part of the initial Promptfoo export subset.
Exporting a Docker `environment` must fail with a clear unsupported-feature
diagnostic instead of silently producing a config that loses isolation,
resources, mounts, or service semantics.

This means Promptfoo export can be fully runnable for Promptfoo-native evals and
for AgentV evals that use supported filesystem/host environment setup. Docker
remains AgentV-native until a deliberate runner/export boundary is accepted.

## Consequences

- Public docs, examples, SDK config, CLI selection flags, and migration tooling
  should use `providers`, `id`, and `label`.
- Old public `targets` authoring is a hard deprecation before release.
- Internal code may keep `target` vocabulary where it reflects existing run
  artifact contracts or Dashboard grouping. Avoid broad artifact renames in the
  provider-surface migration.
- AgentV does not become a Promptfoo fork. It remains a compatible product with
  AgentV-owned environment orchestration, artifacts, dashboard, attempts policy,
  and agent-native providers.
- Promptfoo compatibility should be guarded by CI that validates exported
  Promptfoo configs against Promptfoo's loader or validator.

## Alternatives Considered

### Keep `targets` as the public canonical axis

Rejected. The identity/backend split was clean, but it made every Promptfoo
example look foreign and forced AgentV to document a needless translation for
the most common matrix axis.

### Make every AgentV YAML file directly Promptfoo-runnable

Rejected. Direct execution cannot preserve AgentV's `environment` semantics or
AgentV-native providers. Export/transpile is the correct compatibility boundary
because it can generate provider shims, setup extensions, diagnostics, and
generated files intentionally.

### Emit shell wrappers for built-in providers

Rejected as the default. Shell scripts are not cross-platform and would make
Windows compatibility worse. Generated TypeScript providers or complete package
provider ids are the preferred Promptfoo export forms.

### Export Docker environments as Promptfoo extensions

Rejected for the initial subset. Promptfoo extensions can run commands, but they
do not encode Docker resources, mounts, images, service lifecycle, or provenance
well enough to be a faithful export.
