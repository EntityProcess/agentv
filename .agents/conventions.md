# Technical Conventions

This file expands [AGENTS.md](../AGENTS.md) for code-level rules, naming contracts, wire formats, grader-type rules, and toolchain expectations.

## Toolchain

- Language: TypeScript 5.x targeting ES2022
- Runtime and package manager: Bun
- Monorepo: Bun workspaces
- Bundler: tsup
- Linter and formatter: Biome
- Testing: Vitest
- LLM framework: Vercel AI SDK
- Validation: Zod

## TypeScript Guidelines

- Target ES2022 with Node 20+.
- Prefer type inference over explicit types when the result stays clear.
- Use `async` and `await` for async operations.
- Prefer named exports.
- Keep modules cohesive.

## Subprocess and Provider Conventions

When spawning a subprocess with an explicit `cwd`, pass user-supplied `args` through unchanged. The subprocess resolves its own relative paths against its `cwd`.

- Do not rewrite arg arrays with `startsWith('./')` or `!path.isAbsolute()` heuristics.
- Those heuristics miss bare relative paths such as `plugins/foo`, can corrupt flag-value pairs such as `--config=./x`, and duplicate behavior the subprocess already handles.
- See `docs/learnings/best-practices/trust-subprocess-cwd-for-relative-path-resolution.md`.

## Naming: Project vs Benchmark

These terms are distinct and not interchangeable.

- Project: the top-level container Dashboard organizes around, backed by a registered workspace directory with `.agentv/`, run artifacts, traces, and experiments. The registry lives in `~/.agentv/projects.yaml` and is modeled by `ProjectEntry` and `ProjectRegistry` in `packages/core/src/projects.ts`.
- Benchmark: a curated eval suite designed to measure something specific, in the academic ML sense. Example directories using this meaning are correctly named and should not be renamed.

The legacy `~/.agentv/benchmarks.yaml` file is auto-migrated to `projects.yaml` by `migrateLegacyBenchmarksFile()`. The unrelated per-run `benchmark.json` artifact is a third, separate concept and should keep that name.

Rule of thumb:

- If it holds runs, traces, or experiments, it is a project.
- If it is a curated set of eval cases used to measure capability, it is a benchmark.

## Wire Format Convention

Everything that crosses a process boundary uses `snake_case`. Internal TypeScript uses `camelCase`. Translate only at the boundary.

Snake-case surfaces:

- YAML files on disk such as `*.eval.yaml`, `agentv.config.yaml`, `projects.yaml`, and `dashboard/config.yaml`
- JSONL result files such as `test_id`, `token_usage`, and `duration_ms`
- Artifact-writer output such as `pass_rate`, `tests_run`, and `total_tool_calls`
- HTTP response bodies from `agentv serve` or Dashboard
- CLI JSON output
- Anything consumed by non-TypeScript tooling

Camel-case surfaces:

- TypeScript source
- Internal in-memory shapes passed between TypeScript modules

Translate in one place:

```typescript
interface ProjectEntryYaml {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
}

interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

function fromYaml(entry: ProjectEntryYaml): ProjectEntry {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    addedAt: entry.added_at,
    lastOpenedAt: entry.last_opened_at,
  };
}

function toYaml(entry: ProjectEntry): ProjectEntryYaml {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    added_at: entry.addedAt,
    last_opened_at: entry.lastOpenedAt,
  };
}
```

Anti-patterns:

- `writeFileSync(path, stringifyYaml(tsObject))`
- TypeScript response interfaces with `testId` instead of `test_id`
- Accepting both `testId` and `test_id` on new inputs "for back-compat" when nothing has shipped

If you spot a camelCase key already on disk or in a response, treat it as a bug and migrate it in the same PR that touches that path. `parseJsonlResults()` in `artifact-writer.ts` and `fromYaml` or `toYaml` in `packages/core/src/projects.ts` are the models to follow.

## Grader Type System

Grader types use kebab-case everywhere.

- YAML config: `type: llm-grader`, `type: is-json`, `type: execution-metrics`
- Internal TypeScript: `EvaluatorKind = 'llm-grader' | 'is-json' | ...`
- Output `scores[].type`: `"llm-grader"`, `"is-json"`
- Registry keys: `registry.register('llm-grader', ...)`

Source of truth: `EVALUATOR_KIND_VALUES` in `packages/core/src/evaluation/types.ts`.

Backward compatibility:

- Snake_case is accepted in YAML by `normalizeGraderType()` in `grader-parser.ts`, for example `llm_judge` -> `llm-grader`.
- Single-word types such as `contains`, `equals`, `regex`, `latency`, and `cost` are unchanged.

Two type definitions exist and must stay in sync:

- `EvaluatorKind` in `packages/core/src/evaluation/types.ts`
- `AssertionType` in `packages/sdk/src/assertion.ts`

## Python Scripts

When running Python scripts, always use:

```bash
uv run <script.py>
```
