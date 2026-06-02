---
name: agentv-core-development
description: Use when changing AgentV core, SDK, CLI, Studio APIs, config schemas, docs, examples, or any cross-process wire format. Covers design principles, TypeScript conventions, naming, snake_case boundaries, and documentation updates.
---

# AgentV Core Development

AgentV is a TypeScript monorepo for a declarative AI agent evaluation framework.

## Goals

- Declarative YAML eval definitions.
- Structured, type-safe grading.
- Multi-objective scoring for correctness, latency, cost, and safety.
- Optimization-ready primitives without speculative built-ins.

## Design Principles

- Keep core lightweight and extensible through plugins.
- Built-ins should be universal primitives: deterministic, stateless, single-purpose, and broadly useful.
- Prefer composition over new features. If existing primitives cover a need, document the pattern instead of adding code.
- Research peer frameworks before adding a new capability, and choose the lowest common denominator.
- Apply YAGNI to implementation size, not just feature selection. Audit existing primitives before adding knobs, modes, precedence rules, or new invariants.
- New fields must be optional and non-breaking.
- Design for AI agents: intuitive primitives, self-documenting modules, concise extension recipes in file headers, and no dead speculative infrastructure.

If you notice existing overengineering while working, create a Beads issue titled `cleanup: simplify X` with current behavior, simpler model, migration notes, and code links. Do not widen the current PR unless asked.

## Stack

- TypeScript 5.x targeting ES2022 and Node 20+.
- Bun for all package and script operations.
- Bun workspaces, tsup, Biome, Vitest, Vercel AI SDK, Zod.

## Project Structure

- `packages/core/`: evaluation engine, providers, grading, registry, programmatic API.
- `packages/eval/`: lightweight assertion SDK.
- `apps/cli/`: command-line interface published as `agentv`.
- `apps/studio/`: Studio frontend.
- `apps/web/`: documentation site.
- `examples/`: documentation and integration coverage.

## TypeScript

- Prefer inference over explicit types when clear.
- Use `async`/`await`.
- Prefer named exports.
- Keep modules cohesive.
- Update stale file headers when behavior changes.

## Project vs Benchmark

- `Project`: top-level Studio container around a registered workspace directory. Modelled by `ProjectEntry` / `ProjectRegistry` and stored in `~/.agentv/projects.yaml`.
- `Benchmark`: curated eval suite designed to measure a capability. Example benchmark directories should keep that name.
- Legacy `~/.agentv/benchmarks.yaml` migration and per-run `benchmark.json` artifacts are separate concepts.

When in doubt: if it holds runs/traces/experiments, it is a project. If it is a curated eval suite, it is a benchmark.

## Wire Format

Everything crossing a process boundary uses `snake_case`. Internal TypeScript uses `camelCase`. Translate at the boundary only.

Snake case surfaces include YAML, JSONL result files, artifact output, HTTP responses, CLI JSON, and anything consumed by non-TS tooling. Camel case surfaces are TypeScript variables, parameters, type members, and in-memory shapes.

Use paired wire/internal interfaces and converters, following `packages/core/src/projects.ts`. Do not dump TS objects directly to YAML or JSON responses.

Treat existing camelCase on disk or in responses as a bug when touching that path.

## Documentation

When functionality changes, update:

- Docs site under `apps/web/src/content/docs/`.
- Skills if YAML schema, grader types, or CLI commands changed.
- Examples that exercise changed behavior.
- README only when the high-level pointer changes.
