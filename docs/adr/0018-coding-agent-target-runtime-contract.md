# 18. Coding-agent target runtime contract

Date: 2026-07-05

## Status

Accepted (2026-07-05). Tracks the coding-agent runtime closeout under Beads
`av-t2o5`, `av-y7eq.10`, `av-y7eq.9`, and `av-t2o5.2`.

This ADR records the target runtime contract. It does not claim live provider
matrix completion; host-runtime dogfood evidence is owned by `av-y7eq.9`.
Profile and sandbox isolation evidence is deferred to `av-t2o5.1`.
Provider-agnostic recorded trajectory replay and removal of `provider:
copilot-log` from authored target YAML are owned by `av-t2o5.2`.

## Context

AgentV evaluates coding agents in real repositories. Those agents are not
ordinary LLM APIs: they run tools, read files from disk, mutate workspaces,
manage auth profiles, stream transcripts, and may spawn their own subprocesses.
If AgentV imports fragile agent SDKs directly into the main CLI/orchestrator
process, a provider bug can crash the run before AgentV finalizes
`.agentv/results/<run_id>/`, `summary.json`, `.internal/index.jsonl`,
transcripts, and grading artifacts.

The product direction is repo-native, workspace-native evaluation with portable
run bundles as the source of truth. The default path should therefore evaluate
the real installed agent/profile on the host when that is what the user wants,
while still keeping provider instability inside target execution envelopes.

Peer frameworks are evidence, not schema authority:

- Promptfoo local clone `/home/entity/projects/promptfoo/promptfoo` at commit
  `6bfc5a0c7f16f9c4717ac731d276b578e63d0769` separates coding-agent provider
  families such as Codex SDK, Codex app-server, and Claude Agent SDK. Its
  taxonomy explicitly says provider IDs should encode the runtime boundary.
- Promptfoo also shows useful optional dependency ergonomics: Claude Agent SDK
  is loaded only for that provider, but the SDK still runs in Promptfoo's
  provider process. AgentV adopts optional/lazy SDK loading, but adds an
  AgentV-owned child-runner boundary.
- Vercel `agent-eval` at commit
  `a9dcc9a8c53dbc22ececc967ded7ab3963f18e67` runs coding agents through
  sandboxed CLI-like execution, records raw and parsed transcripts, and writes
  result bundles under `results/<experiment>/<timestamp>/`.
- Margin Evals at commit
  `53fb2fd080689efaf7934573d8759d14fc1043e4` uses run-centric artifacts,
  process/runtime logs, managed agent definitions, and trajectory hooks.
- Harbor uses container environments and ATIF trajectories for benchmark-grade
  agent execution. Its 2026-06-18 change to run `harbor check` and
  `harbor analyze` as Harbor trials instead of in-process Claude SDK calls
  supports the same boundary: produce artifacts from real executions instead
  of hiding work inside the coordinator process.
- Kata Symphony and Taskplane validate Pi RPC as a process/stdio control
  boundary: `pi --mode rpc` is launched as a live subprocess locally, over
  SSH, or through worker orchestration, rather than being collapsed into an
  in-process SDK call.
- entireio/cli preserves native agent sessions and derives normalized
  transcript/checkpoint metadata from provider-specific logs. That pattern
  supports AgentV preserving raw logs as provenance and importing them into
  provider-agnostic replay artifacts, not exposing one live `*-log` target
  provider per backend.

## Decision

AgentV treats coding-agent targets as external runtimes to orchestrate, not
libraries to call in-process by default.

Authored targets use this shape:

```yaml
targets:
  - id: codex-local
    provider: codex-app-server
    runtime: host
    config:
      command: ["codex", "app-server"]
      model: gpt-5-codex
```

The fields mean:

| Field | Meaning |
| --- | --- |
| `id` | Stable AgentV target identity used for CLI selection, artifacts, Dashboard, and comparisons. |
| `provider` | Adapter/control boundary such as `codex-cli`, `codex-app-server`, `pi-rpc`, `claude-cli`, or `copilot-sdk`. |
| `runtime` | Placement/isolation mode: `host`, `profile`, or `sandbox`; may be a string shorthand or an object with `mode`. |
| `config` | Provider-specific knobs such as `command`, `model`, `cwd`, `timeout_seconds`, auth endpoint settings, permission flags, and provider protocol settings. |

Do not add competing top-level fields such as `isolation`, `sandbox`,
`profile`, `install`, `container`, `environment`, `executable`, `binary`,
`args`, or `arguments` for this contract. Process/protocol providers use
`config.command` as a non-empty argv array. Authored eval concurrency belongs
under `evaluate_options.max_concurrency`, not inside a target definition.
Grader selection belongs to `defaults.grader`, CLI overrides, or
evaluator-level target selection, not to the system-under-test target.

### Provider Boundaries

Process and protocol providers are the preferred defaults:

- `codex-app-server`: preferred Codex rich protocol/control boundary.
- `codex-cli`: simple Codex subprocess boundary for host/profile execution and
  installed user shims.
- `pi-rpc`: preferred Pi rich control boundary over stdio/RPC.
- `pi-cli`: simple Pi subprocess boundary.
- `claude-cli`: default Claude path through the installed Claude CLI.
- `copilot-cli`: active Copilot execution through the installed CLI/protocol
  path.

SDK providers are explicit advanced paths:

- `codex-sdk`
- `pi-sdk`
- `claude-sdk`
- `copilot-sdk`

SDK transports run behind an AgentV child-runner process on the host. The parent
CLI/orchestrator starts the child with the target config and provider request,
receives structured events/logs and one final provider response envelope, and
maps child crashes, malformed child output, timeouts, and cancellation into
provider-scoped errors. The concrete SDK package is imported inside the child
runner only for the selected SDK target.

This is process isolation for SDK dependency and crash containment. It is not
Docker/container isolation and does not make `runtime: host` equivalent to
`runtime.mode: sandbox`.

### Runtime Modes

| Runtime | Boundary | Use case |
| --- | --- | --- |
| `host` | Runs the installed CLI, protocol server, or SDK child runner on the current machine with the user's normal auth/profile unless provider config overrides it. | Local research, subscription OAuth, and evaluating the exact installed agent/profile an engineer uses manually. |
| `profile` | Runs a host process with isolated home/provider home/temp/env configuration, such as `HOME`, `CODEX_HOME`, provider homes, temp dirs, and explicit env allowlists. | Cleaner local evals without full container cost. |
| `sandbox` | Runs through a separate substrate such as Docker, a managed sandbox, remote worker, or future container backend. | CI, reproducibility, untrusted tasks, and stronger filesystem/runtime containment. |

Host runtime is the first supported path for coding-agent targets. CLI, RPC,
and app-server transports run against the host-installed agent/profile. SDK
transports also run on the host, but through the AgentV child-runner process
described above.

The current implementation supports Docker sandbox execution for generic
`provider: cli`. Sandbox-aware coding-agent providers are future work. When a
coding-agent provider is authored with `runtime.mode: sandbox` before a
sandbox-aware runner exists, AgentV should return a deliberate
`target_execution` error envelope rather than pretending the target ran or
crashing the evaluator.

Codex `config.sandbox_mode` is a Codex provider permission/sandbox knob passed
to Codex. It is not AgentV `runtime.mode: sandbox`.

### Failure Contract

Coding-agent providers must report target failures through structured
`target_execution` envelopes whenever possible. That includes:

- spawn failures and missing executables
- provider nonzero exits
- malformed provider output
- provider timeouts or cancellations
- SDK child-runner crashes before or after partial events
- sandbox infrastructure failures
- target task failures returned by a protocol provider
- partial transcripts or logs from a failed provider

Target crashes are target results. They must not become AgentV orchestrator
crashes or prevent final run-bundle artifacts from being written.

### Replay and Log Providers

`provider: copilot-log` is removed from the authored live target surface before
beta. AgentV should not add `codex-log`, `claude-log`, `pi-log`, or other
provider-specific log target providers.

Provider-native logs remain useful as raw provenance and import inputs. Copilot
`events.jsonl` parsing should feed import/normalization into a
provider-agnostic recorded trajectory replay contract. Replay is an
eval/orchestrator mode or generic replay target over AgentV trajectory artifacts,
not a live coding-agent runtime provider. Live Copilot targets remain
`copilot-cli` and `copilot-sdk`.

This aligns with ADR 0008: raw native transcripts are preserved for debugging
and parser improvement, while normalized AgentV transcript/trajectory artifacts
are the durable input to grading, Dashboard inspection, and replay.

## Consequences

- Users can evaluate the same host-installed agent/profile they use manually.
- Provider IDs remain explicit about control boundary instead of collapsing
  runtime choices into provider config flags.
- SDK providers stay available when SDK-native events or controls are worth the
  extra complexity, but SDK dependency failures do not take down the parent CLI.
- `runtime: host` remains lightweight and zero-infra; stronger profile/sandbox
  isolation can be added without changing target identity semantics.
- Generic Docker sandbox support through `provider: cli` remains valid, while
  sandbox-aware coding-agent adapters are deliberately deferred.
- Offline grading/replay gets one provider-agnostic path instead of one
  provider-specific `*-log` target surface per backend.

## Alternatives Considered

### Import coding-agent SDKs in the main AgentV process

Rejected. Lazy SDK import is helpful for optional dependencies, but it is not a
runtime isolation boundary. Prior Pi SDK dogfood exposed stream teardown
failures that can outlive the apparent agent result and crash the parent
process. The parent process must own run finalization, timeout enforcement, and
artifact writing.

### Make SDK providers the default because they are structured

Rejected. SDKs can expose useful events, but the default AgentV path should
match the real installed CLI/profile where possible and keep the product
zero-infra. SDK providers are explicit advanced targets.

### Copy Promptfoo provider naming wholesale

Rejected. Promptfoo is useful evidence for explicit provider IDs and optional
provider dependencies, but AgentV keeps target identity and backend/control
boundary separate: `id` is stable AgentV target identity, while `provider` names
the adapter kind. AgentV does not copy Promptfoo's use of `label` as the target
identity field or carry compatibility aliases where the beta contract can be
cleaner.

### Put runtime placement under provider-specific config

Rejected. Runtime placement is cross-provider orchestration state. It belongs in
`runtime`, not in every provider's `config` with different names and precedence
rules.

### Treat provider logs as live target providers

Rejected. Passive logs do not run an agent and should not satisfy live
host-runtime dogfood. They are import/replay sources. Keeping them out of
authored live target YAML avoids a family of `*-log` providers and preserves a
single normalized replay contract.

## Non-Goals

- Implementing or validating the full live provider matrix.
- Implementing profile-mode or sandbox-aware coding-agent provider runners.
- Replacing the generic `provider: cli` sandbox path.
- Designing the full provider-agnostic replay cassette contract.
- Adding compatibility aliases for removed beta-only target provider names.
