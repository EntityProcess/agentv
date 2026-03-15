# AgentV Repository Guidelines

This is a TypeScript monorepo for AgentV - an AI agent evaluation framework.

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
- `code-grader` (also accepts `code-judge`) scripts for custom evaluation logic
- `llm-grader` (also accepts `llm-judge`) evaluators with custom prompt files for domain-specific LLM grading
- CLI wrappers that consume AgentV's JSON/JSONL output for post-processing (aggregation, comparison, reporting)

**Ask yourself:** "Can this be achieved with existing primitives + a plugin or wrapper?" If yes, it should not be a built-in.

### 2. Built-ins for Primitives Only
Built-in evaluators provide **universal primitives** that users compose. A primitive is:
- Stateless and deterministic
- Has a single, clear responsibility
- Cannot be trivially composed from other primitives
- Needed by the majority of users

If a feature serves a niche use case or adds conditional logic, it belongs in a plugin.

### 3. Align with Industry Standards
Before adding features, research how peer frameworks solve the problem. Prefer the **lowest common denominator** that covers most use cases. Novel features without industry precedent require strong justification and should default to plugin implementation.

### 4. YAGNI — You Aren't Gonna Need It
Don't build features until there's a concrete need. Before adding a new capability, ask: "Is there real demand for this today, or am I anticipating future needs?" Numeric thresholds, extra tracking fields, and configurable knobs should be omitted until users actually request them. Start with the simplest version (e.g., boolean over numeric range) and extend later if needed.

### 5. Non-Breaking Extensions
New fields should be optional. Existing configurations must continue working unchanged.

### 6. AI-First Design
AI agents are the primary users of AgentV—not humans reading docs. Design for AI comprehension and composability.

**Skills over rigid commands:**
- Use Claude Code skills (or agent skill standards) to teach AI *how* to create evals, not step-by-step CLI instructions
- Skills should cover most use cases; rigid commands trade off AI intelligence
- Only prescribe exact steps where there's an established best practice

**Intuitive primitives:**
- Expose simple, single-purpose primitives that AI can combine flexibly
- Avoid monolithic commands that do multiple things
- SDK internals should be intuitive enough for AI to modify when needed

**Scope:** Applies primarily to skills, but also to repo structure, documentation, and SDK design—anything AI might need to reason about or extend.

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
  - `src/evaluation/registry/` - Extensible evaluator registry (EvaluatorRegistry, assertion discovery)
  - `src/evaluation/providers/provider-registry.ts` - Provider plugin registry
  - `src/evaluation/evaluate.ts` - `evaluate()` programmatic API
  - `src/evaluation/config.ts` - `defineConfig()` for typed agentv.config.ts
- `packages/eval/` - Lightweight assertion SDK (`defineAssertion`, `defineCodeJudge`)
- `apps/cli/` - Command-line interface (published as `agentv`)
  - `src/commands/create/` - Scaffold commands (`agentv create assertion/eval`)
- `examples/features/sdk-*` - SDK usage examples (custom assertion, programmatic API, config file)

## Quality Assurance Workflow

The repository uses [prek](https://github.com/nickel-lang/prek) (`@j178/prek`) for pre-push hooks that automatically run build, typecheck, lint, and tests before pushing. **Do not manually run these checks before pushing**—just push to the feature branch and let the pre-push hook validate.

**Setup (automatic):**
The hooks are installed automatically when you run `bun install` via the `prepare` script. To manually install:
```bash
bunx prek install -t pre-push
```

**What runs on push:**
- `bun run build` - Build all packages
- `bun run typecheck` - TypeScript type checking
- `bun run lint` - Biome linting
- `bun run test` - All tests

If any check fails, the push is blocked until the issues are fixed.

**Manual run (without pushing):**
```bash
bunx prek run --all-files --hook-stage pre-push
```

## Documentation Updates

When making changes to functionality:

1. **Docs site** (`apps/web/src/content/docs/`): Update human-readable documentation on agentv.dev. This is the comprehensive reference.

2. **Skill files** (`plugins/agentv-dev/skills/agentv-eval-builder/`): Update the AI-focused reference card if the change affects YAML schema, evaluator types, or CLI commands. Keep concise — link to docs site for details.

3. **README.md**: Keep minimal. Links point to agentv.dev.

## Functional Testing

When functionally testing changes to the AgentV CLI, **NEVER** use `agentv` directly as it may run the globally installed npm version. Instead:

- **From TypeScript source (preferred):** `bun apps/cli/src/cli.ts <args>` — always runs current code, no build step needed
- **From built dist:** `bun apps/cli/dist/cli.js <args>` — requires `bun run build` first, can be stale
- **From repository root:** `bun agentv <args>` — runs the locally built version (also requires build)

**Prefer running from source** (`src/cli.ts`) during development. The dist build can silently serve stale code if you forget to rebuild after changes.

## Browser E2E Testing (Docs Site)

Use `agent-browser` for visual verification of docs site changes. Environment-specific rules:

- **Always use `--session <name>`** — isolates browser instances; close with `agent-browser --session <name> close` when done
- **Never use `--headed`** — no display server available; headless (default) works correctly

## Verifying Evaluator Changes

Unit tests alone are insufficient for evaluator changes. After implementing or modifying evaluators:

0. **Preflight (MUST pass before any eval/e2e run):** if you are in a git worktree, ensure a `.env` file exists in the current worktree root.
   - Linux/macOS check: `test -f .env`
   - Windows PowerShell check: `Test-Path .env`
   - If missing, copy it from the main repo before running evals.

1. **Copy `.env` to the worktree** if running in a git worktree (e2e tests need environment variables):
   ```bash
   cp /path/to/main/.env .env
   ```
   ```powershell
   Copy-Item D:/path/to/main/.env .env
   ```
   Do not claim e2e or evaluator verification results unless this preflight has passed.

2. **Run an actual eval** with a real example file:
   ```bash
   bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id <test-id>
   ```

3. **Inspect the results JSONL** to verify:
   - The correct evaluator type is invoked (check `scores[].type`)
   - Scores are calculated as expected
   - Hits/misses reflect the evaluation logic

4. **Update baseline files** if output format changes (e.g., type name renames). Baseline files live alongside eval YAML files as `*.baseline.jsonl` and contain expected `scores[].type` values. There are 30+ baseline files across `examples/`.

5. **Note:** `--dry-run` returns mock responses that don't match evaluator output schemas. Use it only for testing harness flow, not evaluator logic.

## Completing Work — E2E Checklist

Before marking any branch as ready for review, complete this checklist:

1. **Copy `.env` to worktree** (if working in a git worktree):
   ```bash
   cp /home/christso/projects/agentv/.env .env
   ```
   Without this, any eval run or LLM-dependent test will fail with missing API key errors.

2. **Run unit tests**: `bun run test` — all must pass.

3. **Run at least one real eval** against an example file to verify end-to-end behavior:
   ```bash
   bun apps/cli/src/cli.ts eval examples/features/rubric/evals/dataset.eval.yaml --test-id <test-id>
   ```
   Inspect the output JSONL to confirm correct evaluator type, scores, and hits/misses.

4. **Verify no regressions** in areas adjacent to your changes (e.g., if you changed evaluator parsing, run an eval that exercises different evaluator types).

5. **Mark PR as ready** only after all above steps pass.

## Evaluator Type System

Evaluator types use **kebab-case** everywhere (matching promptfoo convention):

- **YAML config:** `type: llm-grader`, `type: is-json`, `type: execution-metrics`
- **Internal TypeScript:** `EvaluatorKind = 'llm-grader' | 'is-json' | ...`
- **Output `scores[].type`:** `"llm-grader"`, `"is-json"`
- **Registry keys:** `registry.register('llm-grader', ...)`

**Source of truth:** `EVALUATOR_KIND_VALUES` array in `packages/core/src/evaluation/types.ts`

**Backward compatibility:** Snake_case is accepted in YAML (`llm_judge` → `llm-grader`) via `normalizeEvaluatorType()` in `evaluator-parser.ts`. Single-word types (`contains`, `equals`, `regex`, `latency`, `cost`) have no separator and are unchanged.

**Two type definitions exist:**
- `EvaluatorKind` in `packages/core/src/evaluation/types.ts` — internal, canonical
- `AssertionType` in `packages/eval/src/assertion.ts` — SDK-facing, must stay in sync

## TypeScript Guidelines
- Target ES2022 with Node 20+
- Prefer type inference over explicit types
- Use `async/await` for async operations
- Prefer named exports
- Keep modules cohesive

## Version Management

This project uses a simple release script for version bumping. The git commit history serves as the changelog.

### Releasing a new version

Run the release script for a version bump:

```bash
bun run release          # patch bump (default)
bun run release minor    # minor bump
bun run release major    # major bump
```

The script will:
1. Validate you're on the `main` branch with no uncommitted changes
2. Pull latest changes from origin
3. Bump version in all package.json files
4. Commit the version bump
5. Create and push a git tag

Recommended publish flow:
```bash
bun run publish:next   # publish current version to npm `next`
bun run promote:latest # promote same version to npm `latest`
bun run tag:next 2.18.0
bun run promote:latest 2.18.0
```

Legacy prerelease flow (still available):
```bash
bun run release:next         # bump to/increment `-next.N`
bun run release next minor   # start a new minor prerelease line as `x.y.0-next.1`
bun run release next major   # start a new major prerelease line as `x.0.0-next.1`
```

## Git Workflow

### Commit Convention

Follow conventional commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Issue Workflow

When working on a GitHub issue, **ALWAYS** follow this workflow:

1. **Create a feature branch** from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b <type>/<issue-number>-<short-description>
   # Example: feat/42-add-new-embedder
   ```

2. **Implement the changes** and commit following the commit convention

3. **Push the branch and create a Pull Request**:
   ```bash
   git push -u origin <branch-name>
   gh pr create --title "<type>(scope): description" --body "Closes #<issue-number>"
   ```

4. **Before merging**, ensure:
   - **E2E verification completed** (see "Completing Work — E2E Checklist" below)
   - CI pipeline passes (all checks green)
   - Code has been reviewed if required
   - No merge conflicts with `main`

**IMPORTANT:** Never push directly to `main`. Always use branches and PRs.

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

Design documents and implementation plans are stored in `.claude/plans/`. These are temporary working materials. Once development concludes, delete the plan file and incorporate any user-relevant details into the official documentation.

#### Git Worktrees

Use the default `.worktrees/` directory (managed by the superpowers skill). After creating a worktree, copy `.env`:
```bash
cp /home/christso/projects/agentv/.env .env
```
This is required for e2e tests, evaluator runs, and any LLM-dependent operations (Azure OpenAI credentials, etc.).

## Package Publishing
- Core package (`packages/core/`) - Core evaluation engine and grading logic (published as `@agentv/core`)
- CLI package (`apps/cli/`) is published as `agentv` on npm
- Uses tsup with `noExternal: ["@agentv/core"]` to bundle workspace dependencies
- Install command: `npm install -g agentv`

## Python Scripts
When running Python scripts, always use: `uv run <script.py>`
