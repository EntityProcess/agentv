---
title: "Blend Promptfoo authoring with Margin and Harbor environment references"
date: 2026-07-05
category: architecture-patterns
module: eval authoring and environment recipes
problem_type: architecture_pattern
component: documentation
severity: medium
applies_when:
  - Designing AgentV environment recipe schema, runtime, artifact provenance, or public examples
  - Comparing AgentV's coding-agent testbed contract against Promptfoo, Margin Evals, Harbor, or Terminal-Bench
  - Deciding whether to add suite/case, benchmark/dataset, target-level environment, or cwd-split concepts
tags:
  - environment-recipes
  - promptfoo
  - margin-evals
  - harbor
  - terminal-bench
  - coding-agents
  - testbeds
  - architecture
---

# Blend Promptfoo authoring with Margin and Harbor environment references

## Context

AgentV needed to preserve the environment design audit from Bead `av-noh3.2.8` outside the tracker because Beads can be pruned or compacted. The audit compared the current AgentV environment recipe plan with Promptfoo, Margin Evals, Harbor, Terminal-Bench 2, and the ai-research-wiki comparison commit.

The conclusion was not to pivot to pure Margin or pure Harbor. AgentV should keep Promptfoo-compatible eval authoring and add an AgentV-owned top-level `environment` recipe for coding-agent testbeds.

## Guidance

Use a deliberate blend:

- **Promptfoo remains the compatibility baseline** for prompts, vars, tests, assertions, targets/providers, top-level `env`, default test config, and lifecycle `extensions`.
- **AgentV owns `environment`** as the typed suite/test/case testbed recipe. Keep it outside `targets`; targets select agents/providers and receive the resolved `environment.workdir`.
- **Margin Evals is the closest local coding-agent UX and artifact reference.** Borrow the product lessons: filesystem-native suite ergonomics, local side-by-side coding-agent runs, immutable run bundles, resume/artifact discipline, and explicit per-case image/cwd/test execution.
- **Harbor and Terminal-Bench 2 are the strongest Docker substrate references.** Borrow explicit Docker image/context/dockerfile, resources, env, workdir controls, dataset/runtime separation, and runner-boundary discipline.

The v1 AgentV recipe fields should stay small: `type: host|docker`, `workdir`, `setup.command`, `setup.args`, `env`, and Docker `image`, `context`, `dockerfile`, `resources`, `mounts`, and `secrets` as the scoped Docker surface. Keep `workdir` explicit for v1. Do not infer authoring semantics from Dockerfile `WORKDIR`, even though Harbor can derive an effective cwd when needed; explicit authoring is easier to review and matches Margin's explicit cwd posture.

Do not add these concepts in the current environment epic:

- Margin's `suite.toml` / `case.toml` schema as AgentV schema
- Harbor's task schema as AgentV schema
- an `agent_cwd` / `test_cwd` split
- a new benchmark/dataset concept
- target-level `environment` or Docker/testbed setup

If separate grader/test cwd becomes necessary later, treat it as a scoped extension with evidence rather than bloating v1.

## Why This Matters

Each reference framework is useful at a different layer. Promptfoo is the authoring compatibility baseline, but its lifecycle hooks and provider env model do not expose a typed testbed/environment primitive. Margin is closer to the local coding-agent workflow AgentV wants, but copying its suite/case schema would create a second AgentV authoring model. Harbor and Terminal-Bench 2 prove the Docker substrate and runner-boundary shape, but copying their full task packaging would pull benchmark-runner concerns into core.

The blend keeps AgentV repo-native and workspace-native: authors can still write familiar Promptfoo-shaped evals, while AgentV adds the missing explicit testbed recipe needed for coding-agent workdir, setup, Docker, and provenance.

## When to Apply

- When implementing environment schema, loading, validation, runtime setup, Docker execution, or artifact provenance.
- When updating ADRs, CONCEPTS, public docs, examples, or AI-facing eval-builder guidance for coding-agent testbeds.
- When a worker proposes moving environment setup under targets, replacing AgentV YAML with Margin/Harbor task schemas, or relying on Promptfoo `extensions` as the canonical testbed setup contract.

## Examples

Preferred framing:

> AgentV combines Promptfoo-compatible eval authoring with AgentV-owned environment recipes: Margin-style local coding-agent UX and artifact discipline, plus Harbor/Terminal-Bench-style explicit Docker substrate.

Avoid these framings:

- "AgentV is Margin-compatible."
- "AgentV uses Harbor task schema."
- "Promptfoo extensions are the environment contract."
- "Dockerfile WORKDIR is the authored AgentV workdir."

## Evidence

- ai-research-wiki commit [`88f2cdba6feb37e00db5e6bc2bbee5ff34b8a36c`](https://github.com/tsoyang-org/ai-research-wiki/commit/88f2cdba6feb37e00db5e6bc2bbee5ff34b8a36c) added the Harbor/SWE-bench/Margin comparison. The local clone at `/home/entity/projects/tsoyang-org/ai-research-wiki` records Harbor as a broad harness/framework, SWE-bench as a benchmark corpus, and Margin as the opinionated local coding-agent runtime.
- Promptfoo local clone `/home/entity/projects/promptfoo/promptfoo` at `6bfc5a0c7f16f9c4717ac731d276b578e63d0769`: `TestSuiteSchema` and `UnifiedConfigSchema` center prompts, providers/targets, tests, default test config, top-level `env`, and lifecycle `extensions`; no typed environment/testbed primitive was found.
- Margin Evals local clone `/home/entity/projects/Margin-Lab/evals` at `53fb2fd080689efaf7934573d8759d14fc1043e4`: docs scaffold `suite.toml`, `cases/<case>/case.toml`, `prompt.md`, `tests/test.sh`, optional `env/Dockerfile`, `image`, `agent_cwd`, `test_cwd`, and `test_timeout_seconds`; runner code writes bundles, progress, artifacts, Docker build logs, and resume metadata.
- Harbor local clone `/home/entity/projects/harbor-framework/harbor` at `a9148a9509a0bc0cbeb80375aa619bd5cdb5845c`: task environment config includes Docker image, OS, CPU/memory/storage/GPU/TPU resources, env, MCP servers, healthcheck, and workdir; runtime config and environment definitions keep runner concerns behind Harbor boundaries.
- Terminal-Bench 2 local clone `/tmp/agentv-terminal-bench-2` at `2fd12b88aafdd04a52c298e3940bcb189f9766d6`: tasks use `task.toml` `[environment]`, `environment/Dockerfile`, `tests/test.sh`, and Dockerfile `WORKDIR` patterns, with tests commonly guarding that a workdir exists.

## Related

- [ADR 0017: Output/artifact contract + environment recipe contract](../../adr/0017-output-artifact-and-workspace-resolver-contract.md)
- [ADR 0018: Coding-agent target runtime contract](../../adr/0018-coding-agent-target-runtime-contract.md)
- [CONCEPTS.md](../../../CONCEPTS.md) entries for Environment, Workdir, Top-level `env`, `environment.env`, Extensions, Target, and Target runtime.
