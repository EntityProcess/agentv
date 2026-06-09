# AgentV Repository Guidelines

This is a TypeScript monorepo for AgentV - an AI agent evaluation framework.

## Local Overrides

If `AGENTS.md.local` exists in the repository root, read it after this file and follow it for machine-local workflow details. `AGENTS.md.local` is intentionally ignored by git; it is for local paths, private asset repositories, and environment-specific verification requirements.

## High-Level Goals

AgentV aims to provide a robust, declarative framework for evaluating AI agents.
- **Declarative Definitions**: Define tasks, expected outcomes, and rubrics in simple YAML files.
- **Structured Evaluation**: Use "Rubric as Object" (Google ADK style) for deterministic, type-safe grading.
- **Multi-Objective Scoring**: Measure correctness, latency, cost, and safety in a single run.
- **Optimization Ready**: Designed to support future automated hyperparameter tuning and candidate generation.

## Design Principles

These principles guide all feature decisions. **Follow these when proposing or implementing changes.**

### 1. Lightweight Core, Plugin Extensibility
AgentV's core should remain minimal. Complex or domain-specific logic belongs in plugins, not built-in features.

**Extension points (prefer these over adding built-ins):**
- `code-grader` scripts for custom evaluation logic
- `llm-grader` graders with custom prompt files for domain-specific LLM grading
- CLI wrappers that consume AgentV's JSON/JSONL output for post-processing (aggregation, comparison, reporting)

**Ask yourself:** "Can this be achieved with existing primitives + a plugin or wrapper?" If yes, it should not be a built-in. This includes adding config overrides to existing graders — if a niche provider needs custom tool-name matching, that's a code-grader, not a new config field.

### 2. Built-ins for Primitives Only
Built-in graders provide **universal primitives** that users compose. A primitive is:
- Stateless and deterministic
- Has a single, clear responsibility
- Cannot be trivially composed from other primitives
- Needed by the majority of users

If a feature serves a niche use case or adds conditional logic, it belongs in a plugin.

### 3. Maximize Feature Surface Through Composition
The goal is to achieve the **maximum feature surface with the minimum primitives** due to high reusability. Before proposing a new feature, enumerate which existing primitives could achieve the same outcome when composed:

- **Oracle validation** is not a feature — it's a `cli` provider target that runs a reference solution through the same evaluators.
- **Snapshot MCP for benchmarks** is not a feature — it's frozen data in the workspace template + `before_all`/`after_all` hooks to start/stop the server.
- **Harness variant comparison** is not a feature — it's target hooks with different `before_each` setup scripts.
- **Skill evaluation** is not a feature — it's `tool-trajectory` + `execution-metrics` + `rubric` composed via `composite`.

**If existing primitives cover it, document the pattern instead of building a feature.** New primitives are justified only when the composition is impossible, not merely when it's undocumented.

### 4. Align with Industry Standards
Before adding features, research how peer frameworks solve the problem. Prefer the **lowest common denominator** that covers most use cases. Novel features without industry precedent require strong justification and should default to plugin implementation.

### 5. YAGNI — You Aren't Gonna Need It
Don't build features until there's a concrete need. Before adding a new capability, ask: "Is there real demand for this today, or am I anticipating future needs?" Numeric thresholds, extra tracking fields, and configurable knobs should be omitted until users actually request them. Start with the simplest version (e.g., boolean over numeric range) and extend later if needed.

**YAGNI applies to *how* you meet a real request, not just *whether* to meet it.** The common failure mode is not "I built X and nobody wanted it." It's "someone asked for X and I built a bigger X than they asked for." Guard against that with these habits:

1. **Audit existing primitives before adding new ones.** When an issue asks for capability Y, the first question is not "how do I build Y?" — it's **"what does the codebase already do that addresses Y?"** Grep for existing functions, endpoints, and config shapes. Many requests are satisfied by a behavior that already exists and just needs to be surfaced, configured, or exercised differently.
2. **Treat issue language as a hint, not a spec.** Issues describe problems *and* implementations. "We need a discovery root" is one implementation of "we need the registry to update live." When an issue lists multiple acceptable approaches (or its acceptance criteria don't actually require the implementation it names), pick the one with the least code surface. Summarize the acceptance criteria in your own words, strip out implementation nouns ("discovery root," "watcher," "registry reload"), then match them against existing primitives before designing anything new.
3. **Prefer data/config changes over new mechanisms.** If the observable effect is "this list should be editable at runtime," prefer "re-read the file per request" over "add a watcher + a new field + a precedence rule + a new endpoint." Config-driven beats code-driven when both are sufficient.
4. **Stop when scope doubles.** If an implementation's surface area grows more than ~2× the starting estimate (extra types, extra endpoints, extra invariants), that's a red flag to re-plan, not a sign to push through. Pause and ask: "What would the smallest possible version look like? Does the issue actually require more than that?"
5. **If you are about to add a second mode, two-layer precedence, or an invariant between two optional fields, stop.** `source: manual | discovered`, "pinned wins over discovered," `excluded_paths` filtering the discovered set — every one of these is a sign that you're in complexity territory that a simpler data model would have avoided.

**Call out existing overengineering.** If, while working on a task, you notice a *current* feature in the repo that looks overengineered relative to what it's used for (multiple modes, optional precedence rules, dead-looking extensibility scaffolding), flag it — don't silently fix it. Open a tracking issue titled "cleanup: simplify X" that lists: the observable behavior today, the simpler model that would cover it, and the migration notes. Link to the code. Do not widen your current PR to absorb the cleanup unless the user asks.

### 6. Non-Breaking Extensions
New fields should be optional. Existing configurations must continue working unchanged.

Same-week or unreleased surfaces can be hard-deprecated. If a field, artifact name, CLI flag, or behavior was introduced in the current calendar week and has not shipped to real external consumers, prefer converging hard to the correct contract instead of carrying aliases, mirrors, or compatibility readers. This is especially important for wire-format names: fix them to the snake_case v1 shape before release. Do not apply this shortcut to established files, flags, config fields, or known consumers; those still need an explicit compatibility, migration, and versioning plan.

### 7. AI-First Design
AI agents are the primary users of AgentV—not humans reading docs. Design for AI comprehension and composability.

**Skills over rigid commands:**
- Use Claude Code skills (or agent skill standards) to teach AI *how* to create evals, not step-by-step CLI instructions
- Skills should cover most use cases; rigid commands trade off AI intelligence
- Only prescribe exact steps where there's an established best practice

**Intuitive primitives:**
- Expose simple, single-purpose primitives that AI can combine flexibly
- Avoid monolithic commands that do multiple things
- SDK internals should be intuitive enough for AI to modify when needed

**Self-documenting code:**
- File headers should explain what the file does, how it works, and how to extend it — no need to read other files to understand this one
- Don't reference external projects, PRs, or issues in code comments; make everything standalone
- Prefer data-driven patterns (static mappings, config tables) over conditional chains — AI can extend a mapping by adding an entry, but has to trace logic to extend an if/else tree
- No dead code or speculative infrastructure; if it's unused, delete it
- When a module has an extension point, include a short recipe in the header (e.g., "To add a new provider: 1. Create a matcher, 2. Add it to the mapping")
- When changing a module's behavior, update its file header to match. Stale headers are worse than no headers.

**Scope:** Applies to skills, repo structure, documentation, SDK design, and source code — anything AI might need to reason about or extend.

## Tech Stack & Tools
- **Language:** TypeScript 5.x targeting ES2022
- **Runtime:** Bun (use `bun` for all package and script operations)
- **Monorepo:** Bun workspaces
- **Bundler:** tsup (TypeScript bundler)
- **Linter/Formatter:** Biome
- **Testing:** Vitest
- **LLM Framework:** Vercel AI SDK
- **Validation:** Zod

## Project Structure
- `packages/core/` - Evaluation engine, providers, grading
  - `src/evaluation/registry/` - Extensible grader registry (EvaluatorRegistry, assertion discovery)
  - `src/evaluation/providers/provider-registry.ts` - Provider plugin registry
  - `src/evaluation/evaluate.ts` - `evaluate()` programmatic API
  - `src/evaluation/config.ts` - `defineConfig()` for typed agentv.config.ts
- `packages/eval/` - Lightweight assertion SDK (`defineAssertion`, `defineCodeGrader`)
- `apps/cli/` - Command-line interface (published as `agentv`)
  - `src/commands/create/` - Scaffold commands (`agentv create assertion/eval`)
- `examples/features/sdk-*` - SDK usage examples (custom assertion, programmatic API, config file)

## Working Style

### Task Tracking and Orchestration
- Treat task tracking instructions as operator-supplied context. If the operator prompt provides an external tracker database, path, or environment variable, use that exact tracker for assignment, status, dependencies, handoff notes, decomposition, and resumability.
- If no external tracker is supplied, work from the user's prompt and the current branch/PR. Do not create, sync, stage, or commit repo-local task tracker state unless the user explicitly requests it.
- Keep private launcher names, local paths, session aliases, dispatch policy, and operator workspace details in `AGENTS.md.local` or outside this public repository.
- GitHub remains the PR, CI, review, and merge surface. Use GitHub Issues or Projects for external collaboration only when the user or operator prompt asks for that workflow.

### Tracker Ownership
- External tracker state belongs to the operator-provided tracker, not this repository.
- Do not add repo-local tracker directories, tracker JSONL exports, dispatch logs, cross-repo research records, or operator decision records to AgentV commits unless the user explicitly asks for repository-local tracker artifacts.
- If external research discovers AgentV implementation work, capture the public code/docs change in a focused branch/PR and keep private research or orchestration records outside this repository.
- When an external tracker is supplied, keep it updated with user-visible decisions, verification evidence, blockers, and handoff state. Run sync or flush commands only against that supplied tracker and keep exported tracker state out of AgentV commits unless explicitly requested.
- Do not use `git stash` on shared checkouts. Other agents may be editing the same worktree, and stashing can hide or replay their changes in the wrong branch. If you need to isolate work, inspect `git status`, stage only your files, use a dedicated worktree, or ask before moving uncommitted changes. If a stash is genuinely unavoidable, immediately broadcast it through Agent Mail with the stash name, affected paths, reason, and recovery plan.

### MCP Agent Mail
- If Agent Mail is part of your local operator workflow, keep server URLs, startup commands, bearer tokens, and canonical project keys in `AGENTS.md.local` or operator workspace docs.
- Before editing shared files, create advisory reservations with `file_reservation_paths` for the intended paths/globs when Agent Mail is configured.
- Use threads for coordination when Agent Mail is configured: `send_message` with a stable `thread_id`, `fetch_inbox` to check mail, and `acknowledge_message` after acting on a message.
- Do not commit project-local Agent Mail config files; they contain bearer tokens and are ignored by `.gitignore`.

### Worktree Setup
- Start every repo change by running `git fetch origin`, inspecting `git status --short --branch`, and checking/reserving the intended paths in Agent Mail when configured.
- Prefer the primary checkout for small, bounded work when all of these are true: local `main` is current with `origin/main` or can be fast-forwarded cleanly; the change is narrow (docs-only, a small single-file fix, or a focused review follow-up); and you hold Agent Mail reservations for the paths you will edit when Agent Mail is configured.
- When working in the primary checkout, stage explicit paths only. Do not commit another agent's files, project-local Agent Mail config, generated evidence, or unrelated tracker/doc state. Reconcile external tracker state in the supplied tracker, not by staging repo-local artifacts.
- Use a dedicated git worktree based on the latest `origin/main` for non-trivial, risky, cross-cutting, long-running, or parallel implementation, or whenever the primary checkout is stale/dirty in paths you need.
- Before starting implementation in a dedicated worktree, verify its `HEAD` is based on the current `origin/main` commit. Do not implement from a stale local `main` or from a branch created off an outdated base.
- Manual setup:
```bash
git fetch origin
git worktree add ../agentv.worktrees/<type>-<short-desc> -b <type>/<issue-or-topic>-<short-desc> origin/main
cd ../agentv.worktrees/<type>-<short-desc>
```
- If you discover you are on a stale base or have uncoordinated dirty files, stop and fix that before changing code.

### Planning
- Use plan mode for any non-trivial task (5+ steps or architectural decisions).
- If something goes sideways, STOP and re-plan immediately — don't keep pushing a broken approach.
- For non-trivial changes, pause and ask: "Is there a more elegant solution?" before diving in.
- Check in with the user before starting implementation on ambiguous tasks.
- Prefer automation: execute the requested work without extra confirmation unless blocked by missing information, safety concerns, or an irreversible/destructive action the user has not approved.

### Worker and Review Strategy
- For complex problems, keep this worker focused on its assigned scope and create or claim additional tracker items when an operator-supplied tracker supports that workflow.
- Before declaring a repo change complete or opening/finalizing a PR, complete manual e2e verification first (see E2E Checklist), **then** run a final review pass when warranted. E2E must pass before review — if e2e fails, fix the issue before investing time in review. The user may explicitly skip the review step.

### Autonomous Bug Fixes
- When you spot a bug, just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them.
- Only ask when there's genuine ambiguity about intent.
- Fix failing CI tests without being told.

### Simplicity
- Every change should be as simple as possible. Import existing code; don't reinvent.
- Find root causes and fix them directly. No shotgun debugging.

### Progress Updates
- Provide high-level status updates at natural milestones.
- When scope changes mid-task, communicate the shift and adjust the plan.
- Use parallel tool calls when applicable, especially for independent reads, checks, and validation steps.

### PR & Commit Titles
- Prefer conventional commit style for branch-facing titles: `type(scope): summary`.
- Use the repository's normal types where they fit, such as `feat`, `fix`, `chore`, `refactor`, `docs`, and `test`.
- Use the most relevant module or product area as `scope`, such as `dashboard`, `cli`, `results`, or `evals`.
- Do not prefix PR titles with `[codex]` unless the user explicitly requests it.

## TypeScript Guidelines
- Target ES2022 with Node 20+
- Prefer type inference over explicit types
- Use `async/await` for async operations
- Prefer named exports
- Keep modules cohesive

## Naming Convention: "Project" vs "Benchmark"

These two words have distinct, non-interchangeable meanings in this codebase. Get them right when adding new symbols, docs, or example dirs:

- **Project** — the top-level container Dashboard organises around: a registered workspace directory (`.agentv/` + run artifacts + traces + experiments). Lives in `~/.agentv/projects.yaml`. Modelled by `ProjectEntry` / `ProjectRegistry` in `packages/core/src/projects.ts`. Matches the terminology used by Phoenix, Langfuse, Braintrust, W&B Weave, and LangSmith.
- **Benchmark** — a curated *eval suite* designed to measure something specific (academic ML sense: MMLU, HumanEval, SWE-bench). Example dirs use this sense: `examples/showcase/multi-model-benchmark/`, `examples/showcase/offline-grader-benchmark/`, `examples/features/benchmark-tooling/`. Do not rename these — they are correctly named.

The legacy registry file `~/.agentv/benchmarks.yaml` is auto-migrated to `projects.yaml` on first load by `migrateLegacyBenchmarksFile()`. The unrelated per-run `benchmark.json` artifact (Agent Skills compatibility output) is a third, separate concept — also keep that name.

When in doubt: if the thing holds runs / traces / experiments, it's a **project**. If it's a curated set of eval cases meant to measure capability, it's a **benchmark**.

## Wire Format Convention

**Everything that crosses a process boundary uses `snake_case` keys. Internal TypeScript uses `camelCase`. Translate at the boundary — never in the middle.**

The rule is blanket: if the key is going to disk, to a user's editor, into a JSON response, or onto a CLI, it's snake_case. There is no "well this file is internal-ish" carve-out. If in doubt, snake_case.

### snake_case surfaces
- All YAML files on disk: `*.eval.yaml`, `agentv.config.yaml`, `projects.yaml`, `dashboard/config.yaml`, any future YAML we add.
- JSONL result files (`test_id`, `token_usage`, `duration_ms`).
- Artifact-writer output (`pass_rate`, `tests_run`, `total_tool_calls`).
- HTTP response bodies from `agentv serve` / Dashboard (`added_at`, `pass_rate`, `project_id`).
- CLI JSON output (`agentv results summary`, `results failures`, `results show`).
- Anything consumed by non-TS tooling (Python, jq pipelines, external dashboards).

### camelCase surfaces
- TypeScript source: all variables, parameters, fields, type members.
- Internal in-memory shapes passed between TS modules.

### Translate only at the boundary
Define a second interface for the wire shape and convert in one place — don't smear snake_case through TS internals.

```typescript
// Wire shape — snake_case, matches what hits disk / the network
interface ProjectEntryYaml {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened_at: string;
}

// Internal shape — camelCase, what every TS call site sees
interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

function fromYaml(e: ProjectEntryYaml): ProjectEntry {
  return { id: e.id, name: e.name, path: e.path, addedAt: e.added_at, lastOpenedAt: e.last_opened_at };
}

function toYaml(e: ProjectEntry): ProjectEntryYaml {
  return { id: e.id, name: e.name, path: e.path, added_at: e.addedAt, last_opened_at: e.lastOpenedAt };
}
```

Yes, this is two interfaces and two functions per entity. That's the price of keeping TS idiomatic while staying faithful to the wire contract. Don't skip it — dumping TS objects directly to YAML leaks `addedAt`-style camelCase onto disk and breaks jq/Python consumers.

### Anti-patterns
- `writeFileSync(path, stringifyYaml(tsObject))` — dumps TS field names verbatim. Wrong.
- `interface Foo { testId: string; ... }` for a JSON response body — `test_id`, always.
- Accepting both `testId` and `test_id` on input "for back-compat" when nothing is shipped yet. Just snake_case.

### Existing divergences
If you spot a camelCase key already on disk or in a response (e.g. a legacy endpoint), treat it as a bug: migrate it to snake_case in the same PR where you touch that code path. Don't grandfather it in.

**Reading back:** `parseJsonlResults()` in `artifact-writer.ts` converts snake_case → camelCase when reading JSONL into TypeScript. `fromYaml` / `toYaml` in `packages/core/src/projects.ts` is the model for YAML boundaries.

**Why:** Aligns with skill-creator (claude-plugins-official) and broader Python/JSON ecosystem conventions where snake_case is the standard wire format.

## Testing & Verification

### CI Gates

GitHub Actions is the authoritative merge gate. The `CI` workflow runs build, typecheck, lint, tests, marketplace checks, docs link checks, and eval schema validation on pushes to `main`, pull requests to `main`, and manual dispatches.

Run the same core checks locally when you need fast feedback:
```bash
bun run verify
bun run validate:examples
```

Task tracker sync is operator-supplied. If the prompt provides an external tracker sync or flush command, run it exactly as instructed and keep exported tracker state out of AgentV commits unless explicitly requested. Hooks must not silently mutate or stash shared worktrees.

NTM hooks are optional local coordination tooling. Do not commit generated task-tracker hook files or local `.ntm/config.toml`; they embed machine-specific paths and can bypass the repo's normal Git behavior when installed via `core.hooksPath`.

If an existing checkout has NTM or prek hooks installed, restore Git's default hook path:
```bash
git config --unset core.hooksPath
```

### Functional Testing (CLI)

When functionally testing changes to the AgentV CLI, **NEVER** use `agentv` directly as it may run the globally installed version (bun or npm). Instead:

- **From TypeScript source (preferred):** `bun apps/cli/src/cli.ts <args>` — always runs current CLI code, no build step needed. **Exception:** changes inside `packages/core/` require `bun run build` first, because the CLI imports `@agentv/core` from its compiled `dist/`, not from TypeScript source.
- **From built dist:** `bun apps/cli/dist/cli.js <args>` — requires `bun run build` first, can be stale
- **From repository root:** `bun agentv <args>` — runs the locally built version (also requires build)

**Prefer running from source** (`src/cli.ts`) during development. The dist build can silently serve stale code if you forget to rebuild after changes. After pulling changes that touch `packages/core/`, always run `bun run build` before CLI testing.

**Dashboard frontend exception — rebuild `apps/dashboard/dist/` before UAT.** Running `agentv dashboard` from source (`bun apps/cli/src/cli.ts dashboard ...`) only reloads the CLI and backend routes from source. The Dashboard web UI (React/Tailwind bundle) is served as static assets from `apps/dashboard/dist/`, which is build output and does **not** recompile on change. After pulling the latest `main`, and before any Dashboard E2E/UAT, rebuild the frontend bundle even if you did not personally edit Dashboard source:

```bash
cd apps/dashboard && bun run build
```

Skipping this step silently serves the previous bundle, so you'll see the old UI even though the source tree and backend API are current. This has burned at least one post-merge UAT; always rebuild before screenshotting or driving Dashboard with `agent-browser`.

### Browser E2E Testing (Docs and Dashboard)

Use `agent-browser` for visual verification of docs site and Dashboard changes. Environment-specific rules:

- **Always use `--session <name>`** — isolates browser instances; close with `agent-browser --session <name> close` when done
- **Never use `--headed`** — no display server available; headless (default) works correctly

**Troubleshooting: `--session` hangs with EAGAIN on ARM64**

If `agent-browser --session <name> open <url>` consistently fails with "Resource temporarily unavailable" or times out, Chrome is taking longer to start than the client's retry window. Workaround: pre-start Chrome manually and use `--cdp`:

```bash
nohup chromium --headless=new --remote-debugging-port=9222 \
  --no-first-run --disable-background-networking --disable-default-apps \
  --disable-sync --ozone-platform=headless --window-size=1280,720 \
  --user-data-dir=/tmp/ab-chrome > /tmp/chrome.log 2>&1 &
curl -s http://localhost:9222/json/version  # verify ready

agent-browser --cdp 9222 open <url>
agent-browser --cdp 9222 screenshot output.png
```

### Agent Provider Eval Concurrency

When running evals against agent provider targets (claude, claude-sdk, codex, copilot, copilot-sdk, pi, pi-cli), **limit concurrency to 3 targets at a time**. Each agent provider spawns heavyweight subprocesses (CLI binaries, SDK sessions) that consume significant memory and CPU. Running more than 3 in parallel can exhaust system resources.

```bash
# Good: batch targets in groups of 2-3
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target claude &
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target codex &
wait
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target copilot &
bun apps/cli/src/cli.ts eval my.EVAL.yaml --target pi &
wait
```

This does not apply to lightweight LLM-only targets (azure, openai, gemini, openrouter) which can run with higher concurrency.

### Writing Tests

Tests should be lean and focused on what matters. Follow these principles:

- **Only test new or changed behavior.** Don't write tests for existing behavior that's already covered by the 1600+ core tests. If you fix a bug, test the fix and its edge cases — not the surrounding module.
- **Protect stable core contracts, not every new detail.** Tests should primarily prevent regressions in existing core behavior: data formats, scoring semantics, routing, persistence, provider contracts, and CLI/API outcomes users depend on. Experimental features, early UI flows, and behavior expected to churn do not need detailed test matrices until the contract stabilizes.
- **One test per distinct behavior.** Don't write separate tests for trivially different inputs that exercise the same code path.
- **No tests for obvious code.** If a function returns `undefined` for missing input and that's a one-line null check, you don't need a test for it unless it's a regression risk.
- **Regression tests > comprehensive tests.** A test that would have caught the bug is worth more than five tests that exercise happy paths.
- **Document churny end-user behavior instead of over-testing it.** When behavior matters to users but changes frequently, prefer updating the Astro docs in `apps/web/src/content/docs/` over locking presentation details, migration variants, or temporary workflows into brittle tests.
- **Tests are executable contracts.** When a module's behavioral contract changes, the tests must reflect the new contract — not just the happy path. If you change what a function promises, update its tests to assert the new promise.

### Verifying Grader Changes

Unit tests alone are insufficient for grader changes. After implementing or modifying graders:

1. **Copy `.env` to the worktree** if running in a git worktree (e2e tests need environment variables):
   ```bash
   cp /path/to/main/.env .env
   ```
   ```powershell
   Copy-Item D:/path/to/main/.env .env
   ```
   Do not claim e2e or grader verification results unless this preflight has passed.

2. **Run an actual eval** with a real example file:
   ```bash
   bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id <test-id>
   ```

3. **Inspect the results JSONL** to verify:
   - The correct grader type is invoked (check `scores[].type`)
   - Scores are calculated as expected
   - Assertions array reflects the evaluation logic (each entry has `text`, `passed`, optional `evidence`)

4. **Update baseline files** if output format changes (e.g., type name renames). Baseline files live alongside eval YAML files as `*.baseline.jsonl` and contain expected `scores[].type` values. There are 30+ baseline files across `examples/`.

5. **Note:** `--dry-run` returns schema-valid mock responses for both agent output and grader evaluation (score=1, empty assertions/checks). Built-in LLM graders run without parse errors but scores are meaningless. Use it for end-to-end harness testing including grader plumbing.

### Checking Grader Score Ranges (manual e2e)

`scripts/check-grader-scores.ts` is a post-processor that asserts each grader's score on each test case falls within an expected range. Run it manually after an eval to catch grader regressions (false positives / false negatives) before merging.

**Workflow:**
```bash
# 1. Run the eval, writing results to a sibling *.results.jsonl file
bun apps/cli/src/cli.ts eval examples/path/to/suite.eval.yaml --target azure \
  --output examples/path/to/suite.run \
  --export examples/path/to/suite.results.jsonl

# 2. Assert all expected score ranges pass
bun scripts/check-grader-scores.ts
```

The script auto-discovers `examples/**/*.grader-scores.yaml`, locates the sibling `*.results.jsonl` (same stem), and exits non-zero if any score is out of range.

**To add score checks for a new eval:**
1. Create `<eval-stem>.grader-scores.yaml` next to the eval YAML.
2. Add entries for each `(test_id, grader, range)` you care about — `grader` must match a `scores[].name` value in the JSONL output, and `range.min`/`range.max` default to 0/1 if omitted.
3. Run the eval with `--output <eval-stem>.run --export <eval-stem>.results.jsonl`, then run the script.

See `examples/red-team/archetypes/coding-agent/suites/screenshot-pii-upload.grader-scores.yaml` for a concrete example.

### Completing Work — E2E Checklist

Before marking any branch as ready for review, complete this checklist:

1. **Preflight:** If in a git worktree, ensure `.env` exists in the worktree root.
   ```bash
   cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
   ```
   Without this, any eval run or LLM-dependent test will fail with missing API key errors.

2. **Run unit tests**: `bun run test` — all must pass.

3. **⚠️ BLOCKING: Manual red/green UAT — must complete before steps 4-5:**
   Unit tests passing is NOT sufficient. Every change must be manually verified from the end user's perspective. Do NOT skip this step or proceed to step 4 until red/green evidence is documented.

   - **Red (before your changes):** Run the scenario on `main` (or the code state before your changes). Confirm the bug or missing feature is observable from the CLI / user-facing output. Capture the output.
   - **Green (with your changes):** Run the identical scenario with your branch. Confirm the fix or feature works correctly from the end user's perspective. Capture the output.
   - **Document both** red and green results in the PR description or comments so reviewers can see the before/after evidence.

   For grader changes, this means running a real eval (not `--dry-run`) and inspecting the output JSONL. For CLI/UX changes, this means running the CLI command and verifying the console output.

4. **Verify no regressions** in areas adjacent to your changes (e.g., if you changed grader parsing, run an eval that exercises different grader types).

5. **Live eval verification**: For changes affecting scoring, thresholds, or grader behavior, run at least one real eval with a live provider (not `--dry-run`) and verify the output JSONL has correct scores, verdicts, and execution status.

6. **Dashboard UX verification**: For changes affecting config, scoring display, or dashboard API, use `agent-browser` to verify the Dashboard UI still renders and functions correctly (settings page loads, pass/fail indicators are correct, config saves work).

7. **Save visual evidence when required by local overrides:** If `AGENTS.md.local` specifies a private evidence repository or asset location, save Dashboard/docs/browser E2E screenshots there and include the resulting paths/commit in the handoff.

8. **Mark PR as ready** only after steps 1-7 have been completed AND red/green UAT evidence is included in the PR.

## Documentation Updates

When making changes to functionality:

1. **Docs site** (`apps/web/src/content/docs/`): Update human-readable documentation on agentv.dev. This is the comprehensive reference.

2. **Skill files** (`plugins/agentv-dev/skills/agentv-eval-builder/`): Update the AI-focused reference card if the change affects YAML schema, grader types, or CLI commands. Keep concise — link to docs site for details.

3. **Examples** (`examples/`): Update any example code, scripts, or eval YAML files that exercise the changed functionality. Examples are both documentation and integration tests.

4. **README.md**: Keep minimal. Links point to agentv.dev.

## Grader Type System

Grader types use **kebab-case** everywhere (matching promptfoo convention):

- **YAML config:** `type: llm-grader`, `type: is-json`, `type: execution-metrics`
- **Internal TypeScript:** `EvaluatorKind = 'llm-grader' | 'is-json' | ...`
- **Output `scores[].type`:** `"llm-grader"`, `"is-json"`
- **Registry keys:** `registry.register('llm-grader', ...)`

**Source of truth:** `EVALUATOR_KIND_VALUES` array in `packages/core/src/evaluation/types.ts`

**Backward compatibility:** Snake_case is accepted in YAML (`llm_judge` → `llm-grader`) via `normalizeGraderType()` in `grader-parser.ts`. Single-word types (`contains`, `equals`, `regex`, `latency`, `cost`) have no separator and are unchanged.

**Two type definitions exist:**
- `EvaluatorKind` in `packages/core/src/evaluation/types.ts` — internal, canonical
- `AssertionType` in `packages/eval/src/assertion.ts` — SDK-facing, must stay in sync

## Git Workflow

### Commit Convention

Follow conventional commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Issue Workflow

Use the operator-supplied tracker, when present, for live ownership and GitHub for external collaboration. Do not duplicate claim state in a separate live tracker. Push focused commits to the assigned branch and open/update the PR requested by the tracker item or user. A branch, pushed commit, or draft PR is not done for ordinary scoped work. Mark tracker items complete only after the scoped work is complete, verified, merged to `main` through a PR, and documented with verification evidence.

Exception: if the tracker item is part of an epic/worktree continuation and the work intentionally remains on an ongoing branch, open a draft PR and record the branch name, PR URL, worktree path, current head commit, and remaining scope in the parent tracker item. In that case, keep the child/task item open or in progress rather than closing it as completed until the PR is merged or the parent explicitly supersedes it.

If a commit is a self-contained unit of completed, verified work, push it directly to its assigned remote branch instead of leaving it local for handoff. This applies to feature branches and artifact/documentation branches. For private asset repositories, follow the relevant untracked local override. It does not override the rule against pushing directly to `main` in this repository.

When working from a GitHub issue instead of an operator-supplied tracker item, use GitHub project state to avoid duplicate work before branching:

```bash
gh issue view <number> --repo EntityProcess/agentv --json number,title,state,projectItems,assignees,url
git fetch origin
git worktree add ../agentv.worktrees/<branch-name> -b <type>/<issue-number>-<short-description> origin/main
cd ../agentv.worktrees/<branch-name>
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
```

After the first meaningful commit, push and open a draft PR unless the user directs a different PR lifecycle:

```bash
git push -u origin <branch-name>
gh pr create --draft --title "<type>(scope): description" --body "Closes #<issue-number>"
```

Complete E2E verification before marking a PR ready for review. Never push directly to `main`; always use branches and PRs.

### Tracker Conventions

- GitHub Issues + Projects are external collaboration surfaces, not a substitute for operator-supplied tracker state unless explicitly directed.
- `bug` marks defects.
- Issues without `bug` are non-bug work by default.
- `core`, `wui`, and `tui` are area labels.
- Keep issue bodies focused on the handoff contract: objective, design latitude, acceptance signals, non-goals, and related links.
- Do not put priority metadata in issue bodies.

### Pull Requests

**Always use squash merge** when merging PRs to main. This keeps the commit history clean with one commit per feature/fix.

```bash
# Using GitHub CLI to squash merge a PR
gh pr merge <PR_NUMBER> --squash --delete-branch

# Or with auto-merge enabled
gh pr merge <PR_NUMBER> --squash --auto
```

Do NOT use regular merge or rebase merge, as these create noisy commit history with intermediate commits.

### After Squash Merge

Once a PR is squash-merged, its source branch diverges from main. **Do NOT** try to push additional commits from that branch—you will get merge conflicts.

For follow-up fixes:
```bash
git checkout main
git pull origin main
git checkout -b fix/<short-description>
# Apply fixes on the fresh branch
```

### Plans and Worktrees

#### Plans

Design documents and implementation plans are stored in `docs/plans/` inside the worktree (not the main repo). Save plans to the worktree so they are committed on the feature branch and visible in the draft PR.

**Path warning:** When working in a worktree, use paths relative to the worktree root (e.g., `docs/plans/plan.md`). Do NOT prefix with the worktree directory from the main repo (e.g., `agentv.worktrees/feat/xxx/docs/plans/plan.md`) — this creates accidental nested directories inside the worktree.

Plans are temporary working materials. **Before merging the PR**, delete the plan file and incorporate any user-relevant details into the official documentation.

#### Git Worktrees

Use the sibling `../agentv.worktrees/` directory for all AgentV worktrees. This overrides any generic skill or default preference for `.worktrees/` or `worktrees/` inside the repository. Do not create new AgentV worktrees inside the repository root.

After creating a manual worktree, always run setup:
```bash
bun install                                    # worktrees do NOT share node_modules
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env    # required for e2e tests and LLM operations
```
Both steps are required before running builds, tests, or evals in the worktree.

### After Checking Out an Existing Branch or PR

Whenever you `git checkout`, `gh pr checkout`, `git pull`, or otherwise switch to a ref that may have changed `package.json` / `bun.lock`, run `bun install` before building or testing. If dependencies are stale, CI/local checks can fail with errors like `Cannot find module 'recharts'` even though the source change is unrelated. `bun install` is cheap when already up-to-date, so run it by default after any ref switch.

## Version Management

This project uses a simple release script for version bumping. The git commit history serves as the changelog.

### Releasing a new version

Use the **GitHub Actions workflows** — do not publish manually from a local machine.

**Standard flow (pre-release → stable):**
1. Run the [Release workflow](https://github.com/EntityProcess/agentv/actions/workflows/release.yml) with `channel=next` (and desired bump: patch/minor/major). This bumps the version to `x.y.z-next.1`, commits, tags, and pushes.
2. The [Publish workflow](https://github.com/EntityProcess/agentv/actions/workflows/publish.yml) triggers automatically and publishes to npm `next`.
3. Run the [Release workflow](https://github.com/EntityProcess/agentv/actions/workflows/release.yml) with `channel=finalize`. This strips the `-next.N` suffix (e.g. `4.12.0-next.1` → `4.12.0`), commits, tags, and pushes.
4. The Publish workflow triggers automatically and publishes to npm `latest`.

**Direct stable release (skip pre-release):**
1. Run the Release workflow with `channel=stable` (and bump).
2. Publish workflow auto-publishes to npm `latest`.

The release script (`bun scripts/release.ts`) is what the Release workflow calls; it can also be run locally for non-publishing tasks (e.g. inspecting version state), but **do not run `bun run publish` or `bun run publish:next` locally** — npm publish uses OIDC trusted publishing which only works in GitHub Actions.

## Package Publishing
- Core package (`packages/core/`) - Core evaluation engine and grading logic (published as `@agentv/core`)
- CLI package (`apps/cli/`) is published as `agentv` on npm
- Uses tsup with `noExternal: ["@agentv/core"]` to bundle workspace dependencies
- Install command: `bun install -g agentv` (preferred) or `npm install -g agentv`

## Python Scripts
When running Python scripts, always use: `uv run <script.py>`
