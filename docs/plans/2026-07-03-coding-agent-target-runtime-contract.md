---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: av-vrx8-research
execution: code
title: "Coding-agent target runtime contract"
created_at: 2026-07-03
type: feature
bead: av-y7eq
---

# Coding-agent target runtime contract

## Goal Capsule

- **Objective:** Make AgentV's coding-agent targets reliable by default while
  preserving rich transcripts and local "run the agent I use" workflows.
- **Core decision:** Target authoring uses the compact shape
  `id` + `provider` + `runtime` + `config`. SDK-backed coding-agent
  providers, when retained, default to internal process isolation rather than
  importing risky agent SDKs in the AgentV orchestrator process.
- **Primary Bead:** `av-y7eq`
- **Implementation Beads:** `av-y7eq.1` through `av-y7eq.5`; existing SDK
  subprocess follow-up `av-57i` / `av-57i.1`.
- **Non-goal:** Do not replace AgentV with Promptfoo, Symphony, Kata, Margin, or
  Vercel agent-eval. Borrow their proven boundaries and keep AgentV's
  repo-native run bundle model.

## Summary

AgentV should treat coding-agent targets as external runtimes to orchestrate,
not as libraries to call in-process by default. The default path should be
subprocess, protocol, or sandbox based:

- Codex: `codex-app-server` first for rich protocol control, `codex-cli` as the
  simpler process-boundary path, `codex-sdk` explicit and internally isolated.
- Pi: `pi-rpc` or `pi-cli` first, following Kata's `pi --mode rpc` pattern;
  `pi-coding-agent`/`pi-sdk` explicit and internally isolated if retained.
- Claude: `claude-cli` first; `claude-sdk` explicit and internally isolated if
  retained. There is no separate Claude app-server/RPC surface identified.
- Copilot: prefer CLI/session-log/process-boundary paths where possible;
  `copilot-sdk` follows the same explicit SDK isolation rule.

The target schema should not expose every implementation detail as a top-level
field. Runtime placement is a single concept:

```yaml
targets:
  - id: codex-local
    provider: codex-app-server
    runtime: host
    config:
      command: ["codex", "--config", "model_reasoning_effort=high"]
      model: gpt-5-codex
```

Expanded form is used only when needed:

```yaml
targets:
  - id: codex-clean
    provider: codex-cli
    runtime:
      mode: profile
      home: .agentv/profiles/codex-clean
    config:
      command: ["codex", "--sandbox", "workspace-write"]
      model: gpt-5-codex
```

```yaml
targets:
  - id: pi-rpc-local
    provider: pi-rpc
    runtime: host
    config:
      command: ["pi"]
      model: gpt-5-codex
```

## Product Contract

### Stable Fields

| Field | Meaning |
| --- | --- |
| `id` | Stable target identity. Used by CLI selection, run artifacts, Dashboard, and comparisons. |
| `provider` | Adapter/control protocol kind: `codex-cli`, `codex-app-server`, `codex-sdk`, `pi-cli`, `pi-rpc`, `claude-cli`, `claude-sdk`, etc. |
| `runtime` | Where and how the provider runs: `host`, `profile`, or `sandbox`. May be a string shorthand or an object with `mode`. |
| `config` | Provider-specific configuration. Keep `model`, `command`, timeouts, permission flags, and provider knobs here. |

Do not add competing top-level fields such as `isolation`, `sandbox`,
`install`, `container`, `environment`, or `profile`. Those details live under
`runtime` or `config` only when a provider needs them.

### Clean Contract

This plan assumes a breaking cleanup. Do not preserve legacy target aliases or
compatibility-only fields in the new authored contract.

For process-backed coding-agent providers, `config.command` is a non-empty argv
array. The first token is the executable or shim, such as `codex`,
`codex-personal`, `pi`, or an absolute binary path. Remaining tokens are extra
arguments. Do not add separate `args`, `arguments`, `executable`, or `binary`
fields to the new contract.

```yaml
targets: file://targets.yaml
graders: file://graders.yaml

defaults:
  target: codex-local
  grader: openai-grader
```

```yaml
# targets.yaml
- id: codex-local
  provider: codex-app-server
  runtime: host
  config:
    command: ["codex", "--config", "model_reasoning_effort=high"]
    model: gpt-5-codex
```

Keep provider-specific knobs under `config`, using one canonical name per
concept. Examples:

- common target runtime config: `command`, `model`, `cwd`, `timeout_seconds`,
  `system_prompt`, `stream_log`, `log_dir`
- Codex config: `reasoning_effort`, `model_verbosity`, `base_url`, `api_key`,
  `api_format`, `sandbox_mode`, `approval_policy`
- Pi config: `subprovider`, `tools`, `thinking`
- Claude config: `max_turns`, `max_budget_usd`, `bypass_permissions`
- Copilot config: custom provider/auth settings and ACP/prompt mode settings

Orchestration policy is not target runtime config. Keep `workers`, batching,
retry policy, and subagent dispatch under project/run policy such as
`execution`, not inside target definitions.

Grader selection is a separate registry/default concern. Do not put
`grader_target` on targets in the clean schema. Use `defaults.grader` for the
project default, CLI `--grader` / `--grader-target` for run override, and
per-evaluator `target` for a specific grader override.

Promptfoo's comparable mechanism is assertion/test grading provider selection:
assertions can set a `provider`, tests/defaultTest can provide fallback grading
providers, and model-graded matchers fall back to type-specific default grading
providers. It does not put grader selection in the target provider runtime.

### Project File Layout

Keep registries separate from policy:

```text
.agentv/
  config.yaml
  targets.yaml
  graders.yaml
```

Project-local `.agentv/config.yaml` should remain the portable project policy
file: defaults, `execution`, `eval_patterns`, `refs`, tags, result defaults, and
other run-level settings. It may point at the default target/grader by name, but
it should not become the registry that holds all target and grader definitions.
Following Promptfoo's modular-config idiom, use direct field references rather
than a named import table:

```yaml
# .agentv/config.yaml
targets: file://targets.yaml
graders: file://graders.yaml

defaults:
  target: codex-local
  grader: openai-grader

execution:
  workers: 3
```

Do not introduce a greenfield `files:` or `imports:` section for this unless
AgentV needs a capability that direct field references cannot express.
Promptfoo's pattern is `providers: file://configs/providers.yaml`,
`tests: file://tests/`, and `defaultTest: file://configs/default-test.yaml`;
the field being configured names the thing being loaded.

`targets.yaml` should remain the registry of subjects under test. `graders.yaml`
should be the registry of reusable grading providers. This keeps target runtime
contracts reviewable, keeps grader credentials/endpoints separate from agent
runtimes, and matches AgentV's existing artifact model where run manifests carry
explicit `targets_path` and `graders_path` entries.

For Promptfoo-style field references, the referenced file should contain the
value for that field. Greenfield examples:

```yaml
# .agentv/targets.yaml
- id: codex-local
  provider: codex-app-server
  runtime: host
  config:
    command: ["codex"]
```

```yaml
# .agentv/graders.yaml
- id: openai-grader
  provider: openai
  config:
    model: gpt-5-mini
```

Do not accept wrapped forms such as `targets: [...]` inside a file already
loaded through `targets: file://targets.yaml`. The referenced file is the field
value.

The global `$AGENTV_HOME/config.yaml` is different: it owns Dashboard/operator
state such as the `projects:` registry. Do not use the existence of global
`projects:` as a reason to put project-local target/grader registries into
project-local `.agentv/config.yaml`.

Greenfield, the cleanest global shape would put Dashboard project registry
state in `$AGENTV_HOME/projects.yaml` and leave `$AGENTV_HOME/config.yaml` for
global settings. If using Promptfoo-style references, the global config would
say `projects: file://projects.yaml`.

Do not add `dashboard.app_name` or other user-configurable AgentV branding to
the clean config contract. Dashboard product identity is not project policy.

Promptfoo's comparable file-structure guidance is simpler: a main
`promptfooconfig.yaml` commonly contains `providers`, `prompts`, `defaultTest`,
and `tests`, while larger configs can reference external files such as provider
YAML with `file://...`. Promptfoo does not have AgentV's separate home-scoped
Dashboard project registry, so it is useful as a modular-config reference but
not a direct reason to collapse AgentV's project, target, and grader registries
into one file.

### Runtime Modes

| Runtime | Boundary | Use case |
| --- | --- | --- |
| `host` | User's installed runtime and normal config/auth/skills/plugins. | Local research and "evaluate the exact agent I use." |
| `profile` | Host process execution with isolated home/config/env, such as `CODEX_HOME`, `HOME`, temp dirs, and explicit auth profile. | Cleaner local evals without full container cost. |
| `sandbox` | Separate execution substrate such as Docker, Vercel Sandbox, remote worker, or another container/sandbox backend. | CI, reproducibility, untrusted tasks, stronger crash and filesystem containment. |

A sandbox may contain an internal profile, but the top-level runtime remains
`sandbox` because the execution substrate boundary is stronger than host-side
config isolation.

### SDK Rule

SDK-backed coding-agent providers are allowed only as explicit provider kinds
and should default to internal process isolation:

```yaml
targets:
  - id: codex-sdk-isolated
    provider: codex-sdk
    runtime: host
    config:
      model: gpt-5-codex
```

The YAML should not need an opt-in such as `sdk_isolation: process` for the
safe path. If AgentV cannot isolate an SDK provider yet, that provider should be
documented as explicit/non-default or temporarily rejected with an actionable
message.

The parent AgentV process must not import the risky coding-agent SDK for the
default safe path. Instead, use a provider child runner:

```text
AgentV parent
  -> spawn child runner with target config + provider request JSON
  <- NDJSON events/logs
  <- one final ProviderResponse envelope
  <- child exit status
```

Failure mapping:

- child nonzero exit before result -> target error
- malformed child JSON -> target error
- timeout/cancel -> kill child process group, target timeout error
- crash after partial transcript -> failed target result with partial logs
- parent still finalizes `index.jsonl`, summaries, transcripts, and run bundle

## External Pattern Mapping

| Source | Relevant pattern | AgentV decision |
| --- | --- | --- |
| Promptfoo | Provider object uses `id` plus optional `label` and `config`; Codex and Claude SDK providers put `model` in `config.model`; direct SDK adapters exist. | Use `id` for stable identity, keep `provider`/`config` ergonomics, keep `model` under `config`, and do not make in-process SDK the default. |
| OpenAI Symphony | Codex app-server subprocess with workspace/session orchestration, approval/sandbox policy, max-turn boundaries, and structured streaming/status. | Use `codex-app-server` as the preferred rich-control Codex provider. |
| Kata Symphony | Pi is launched as `pi --mode rpc` locally or over SSH and controlled over stdio/RPC; workers must already have the runtime installed. | Add/prefer `pi-rpc` for rich Pi control; do not import Pi coding-agent SDK into AgentV's orchestrator. |
| Vercel agent-eval | Installs agent CLIs inside ephemeral sandboxes and captures transcripts from CLI JSON/session logs. | `runtime.mode: sandbox` should support managed/pinned CLI install and transcript capture without host config bleed. |
| Margin Evals | Runs cases in Docker, captures PTY/runtime/control logs, optional ATIF trajectory hooks. | Treat container/sandbox as runtime substrate and preserve logs/trajectories as run artifacts. |
| SWE-bench | Applies predictions and runs tests inside Docker containers with logs, timeouts, and cleanup. | Keep container details under runtime/harness config, not target identity. |
| DeepEval | Pytest/metric/tracing loop that coding agents can call, not a coding-agent target orchestrator. | Useful grader/eval-loop reference, not a target runtime model. |

## Provider Contract

### Codex

Use explicit provider kinds:

- `codex-cli`: spawn `codex exec` or a user shim. Capture stdout/stderr, JSONL
  stream, exit code, final text, and raw logs.
- `codex-app-server`: spawn `codex app-server` or a user shim plus app-server
  args. Prefer for rich transcript, turn/session control, cancellation, and
  structured JSON-RPC events.
- `codex-sdk`: explicit SDK provider. Internally isolated in a child process if
  retained.

Do not add `codex-rpc` unless Codex exposes a distinct RPC mode separate from
app-server. For Codex, app-server is the protocol provider.

`config.command` is the argv array for the executable or shim. It is not the
provider identity:

```yaml
targets:
  - id: codex-personal
    provider: codex-cli
    runtime: host
    config:
      command: ["codex-personal", "--model", "gpt-5-codex"]
```

```yaml
targets:
  - id: codex-eng
    provider: codex-cli
    runtime: host
    config:
      command: ["codex-eng", "--model", "gpt-5-codex"]
```

### Pi

Use explicit provider kinds:

- `pi-cli`: simple Pi CLI subprocess and transcript capture.
- `pi-rpc`: Kata-style protocol subprocess that launches `pi --mode rpc` and
  controls it over stdio/RPC.
- `pi-coding-agent` or `pi-sdk`: explicit SDK provider only; internally
  isolated if retained.

Keep `pi-ai` for plain LLM/model calls. Do not treat `pi-ai` as the coding-agent
runtime boundary.

### Claude

Use explicit provider kinds:

- `claude-cli`: default subprocess path using structured stream output.
- `claude-sdk`: explicit SDK provider using `@anthropic-ai/claude-agent-sdk`,
  internally isolated if retained.

No separate Claude app-server/RPC provider has been identified. The CLI
structured stream is the subprocess-first rich transcript path. Claude Agent SDK
may spawn Claude Code internally, but importing the SDK in AgentV still creates
an in-process adapter risk unless wrapped by a child runner.

### Copilot

Keep provider names explicit by control boundary:

- `copilot-cli`: subprocess/protocol CLI path.
- `copilot-log`: passive transcript/log replay path.
- `copilot-sdk`: explicit SDK path, internally isolated if retained.

## Implementation Units

### U1. Target Schema And Docs (`av-y7eq.1`)

- Add `runtime: host` shorthand and `runtime.mode: host | profile | sandbox`.
- Keep `model` and `command` under `config`.
- Use `id` as target identity and `provider` as adapter/backend kind.
- Reject invalid runtime modes with focused validation errors.
- Document why `runtime` is the umbrella field.

### U2. Codex Host/Profile Providers (`av-y7eq.2`)

- Split current ambiguous `codex` registry behavior into explicit
  `codex-cli`, `codex-app-server`, and `codex-sdk`.
- Remove the bare `codex` provider name from the authored clean contract. Users
  must choose `codex-cli`, `codex-app-server`, or `codex-sdk` explicitly.
- Support `config.command` shims such as `codex-personal` and `codex-eng`.
- Implement host/profile environment construction, including deliberate
  `HOME`, `CODEX_HOME`, temp dirs, and env allowlists for profile mode.

### U3. Sandbox Runtime (`av-y7eq.3`)

- Implement `runtime.mode: sandbox` using the existing or smallest viable
  sandbox/container substrate.
- Install or locate the target CLI inside the sandbox with pinned/configurable
  inputs.
- Mount only explicit workspace, result, and credential paths.
- Preserve stdout/stderr/transcript artifacts and distinguish sandbox infra
  failure from target task failure.

### U4. SDK Provider Isolation (`av-y7eq.4`, `av-57i`, `av-57i.1`)

- Move retained coding-agent SDK providers behind child-runner process
  boundaries.
- Start with Pi SDK isolation if that remains the quickest proof slice.
- Generalize only after the first provider proves the protocol.
- Do not install broad parent-process exception/EPIPE swallowing.

### U5. Pi RPC Runtime (`av-y7eq.5`)

- Add or document `pi-rpc` as the preferred rich-control Pi provider.
- Launch `pi --mode rpc` through a process/stdio boundary.
- Model remote execution after Kata only where AgentV needs it; worker
  provisioning can remain explicit and out of scope for the first slice.
- Keep `pi-coding-agent` SDK explicit/non-default.

## Result And Artifact Requirements

Every coding-agent provider must return or fail through a structured result
envelope. AgentV must preserve:

- target id, provider kind, runtime mode, command, cwd, and model
- stdout/stderr logs
- structured event transcript when available
- final assistant output
- tool/file-change events when available
- timeout, cancellation, spawn failure, nonzero exit, malformed output, and
  crash metadata
- partial transcript/logs on failure

Target crashes are target results. They must not become AgentV orchestrator
crashes.

## Open Questions

- Whether to rename `pi-coding-agent` to `pi-sdk` during the major cleanup or
  replace the existing provider name with the shorter explicit SDK name.
- Which sandbox substrate should be the first implementation target if existing
  AgentV runner support is insufficient.
- How much transcript normalization belongs in provider adapters versus a shared
  transcript post-processor.

## Validation Plan

- Schema tests for `runtime` shorthand/object forms and invalid values.
- Provider registry tests proving explicit provider names and no bare `codex`
  fallback to SDK.
- Codex CLI/app-server tests for command shims, host/profile env, timeout kill,
  nonzero exit, malformed output, and transcript capture.
- Pi RPC tests with a fake `pi --mode rpc` process.
- SDK child-runner tests for success, child crash before result, child crash
  after partial events, malformed JSON, timeout, and cancellation.
- Docs/examples validation after examples are updated.
- Live provider dogfood before implementation PRs are marked ready, per repo
  verification rules.

## Handoff

Implementation workers should start with `av-y7eq.1` before provider changes so
the normalized contract exists. `av-y7eq.2` and `av-y7eq.5` can then proceed in
parallel for Codex and Pi subprocess/protocol providers. `av-y7eq.4` should
coordinate with `av-57i.1` rather than creating a second SDK isolation design.
