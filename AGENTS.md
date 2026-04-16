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

### Worktree Setup
- For any feature, bug fix, or non-trivial repo change, work from a dedicated git worktree based on the latest `origin/main`.
- Before starting implementation, run `git fetch origin` and verify your worktree `HEAD` is based on the current `origin/main` commit.
- Do not implement from the primary checkout, from a stale local `main`, or from a branch created off an outdated base.
- Default setup:
```bash
git fetch origin
git worktree add ../agentv.worktrees/<type>-<short-desc> -b <type>/<issue-or-topic>-<short-desc> origin/main
cd ../agentv.worktrees/<type>-<short-desc>
```
- If you discover you are not on a fresh worktree from the latest `origin/main`, stop and fix that first before changing code.

### Planning
- Use plan mode for any non-trivial task (5+ steps or architectural decisions).
- If something goes sideways, STOP and re-plan immediately — don't keep pushing a broken approach.
- For non-trivial changes, pause and ask: "Is there a more elegant solution?" before diving in.
- Check in with the user before starting implementation on ambiguous tasks.

### Subagent Strategy
- Use subagents aggressively to keep the main context window clean.
- Subagents for: research, file exploration, running tests, code review.
- For complex problems, throw more subagents at it — parallelize where possible.
- Name subagents descriptively.
- Before declaring a repo change complete or opening/finalizing a PR, complete manual e2e verification first (see E2E Checklist), **then** spawn a subagent for a final code review pass. E2E must pass before code review — if e2e fails, fix the issue before investing time in review. The user may explicitly skip the review step.

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

## TypeScript Guidelines
- Target ES2022 with Node 20+
- Prefer type inference over explicit types
- Use `async/await` for async operations
- Prefer named exports
- Keep modules cohesive

## Wire Format Convention

**All external-facing JSON and JSONL output uses `snake_case` keys.** This applies to:
- JSONL result files on disk (`test_id`, `token_usage`, `duration_ms`)
- Artifact-writer output (`pass_rate`, `tests_run`, `total_tool_calls`)
- CLI command JSON output (`results summary`, `results failures`, `results show`)
- YAML eval config fields

**Internal TypeScript uses `camelCase`** as standard. Convert at the serialization boundary only:

```typescript
// Interfaces for JSON output use snake_case (they define the wire format)
interface SummaryJson {
  total: number;
  pass_rate: number;
  failed_test_ids: string[];
}

// Function internals use camelCase (idiomatic TypeScript)
function formatSummary(results: EvaluationResult[]): SummaryJson {
  const passRate = computePassRate(results);
  const failedTestIds = findFailed(results);

  return {
    total: results.length,
    pass_rate: passRate,
    failed_test_ids: failedTestIds,
  };
}
```

**Reading back:** `parseJsonlResults()` in `artifact-writer.ts` converts snake_case → camelCase when reading JSONL into TypeScript.

**Why:** Aligns with skill-creator (claude-plugins-official) and broader Python/JSON ecosystem conventions where snake_case is the standard wire format.

## Testing & Verification

### Pre-Push Hooks (Automated)

The repository uses [prek](https://github.com/nickel-lang/prek) (`@j178/prek`) for pre-push hooks that automatically run build, typecheck, lint, and tests before pushing. **Do not manually run these checks before pushing** — just push to the feature branch and let the pre-push hook validate.

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
- `bun run validate:examples` - Validate example eval YAML files against the agentv schema

If any check fails, the push is blocked until the issues are fixed.

**Manual run (without pushing):**
```bash
bunx prek run --all-files --hook-stage pre-push
```

### Functional Testing (CLI)

When functionally testing changes to the AgentV CLI, **NEVER** use `agentv` directly as it may run the globally installed version (bun or npm). Instead:

- **From TypeScript source (preferred):** `bun apps/cli/src/cli.ts <args>` — always runs current CLI code, no build step needed. **Exception:** changes inside `packages/core/` require `bun run build` first, because the CLI imports `@agentv/core` from its compiled `dist/`, not from TypeScript source.
- **From built dist:** `bun apps/cli/dist/cli.js <args>` — requires `bun run build` first, can be stale
- **From repository root:** `bun agentv <args>` — runs the locally built version (also requires build)

**Prefer running from source** (`src/cli.ts`) during development. The dist build can silently serve stale code if you forget to rebuild after changes. After pulling changes that touch `packages/core/`, always run `bun run build` before CLI testing.

**Studio frontend exception — rebuild `apps/studio/dist/` before UAT.** Running `agentv studio` from source (`bun apps/cli/src/cli.ts studio ...`) only reloads the CLI and backend routes from source. The Studio web UI (React/Tailwind bundle) is served as static assets from `apps/studio/dist/`, which is build output and does **not** recompile on change. If you are testing Studio UI changes — especially post-merge on `main` or after pulling — rebuild the frontend first:

```bash
cd apps/studio && bun run build
```

Skipping this step silently serves the previous bundle, so you'll see the old UI even though your source edits and the backend API are live. This has burned at least one post-merge UAT; always rebuild before screenshotting or driving Studio with `agent-browser`.

### Browser E2E Testing (Docs Site)

Use `agent-browser` for visual verification of docs site changes. Environment-specific rules:

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
- **One test per distinct behavior.** Don't write separate tests for trivially different inputs that exercise the same code path.
- **No tests for obvious code.** If a function returns `undefined` for missing input and that's a one-line null check, you don't need a test for it unless it's a regression risk.
- **Regression tests > comprehensive tests.** A test that would have caught the bug is worth more than five tests that exercise happy paths.
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

5. **Note:** `--dry-run` returns schema-valid mock responses (`{}` as output, zeroed `tokenUsage`). Built-in graders will not crash, but scores are meaningless. Use it for testing harness flow, not grader logic.

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

6. **Studio UX verification**: For changes affecting config, scoring display, or studio API, use `agent-browser` to verify the studio UI still renders and functions correctly (settings page loads, pass/fail indicators are correct, config saves work).

7. **Mark PR as ready** only after steps 1-6 have been completed AND red/green UAT evidence is included in the PR.

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

When working on a GitHub issue, **ALWAYS** follow this workflow:

1. **Claim the issue** — prevents other agents from duplicating work:
   ```bash
   # Load AGENT_ID from .env; if not set, ask the user or default to <harness>-<model>
   # Harness = the coding tool (claude-code, opencode, codex-cli, cursor, etc.)
   # Model = the LLM (opus, sonnet, o3, etc.)
   # Examples: "claude-code-opus", "opencode-sonnet", "cursor-o3", "codex-cli-o3"
   # In this local dev environment, default to "devbox2-codex" unless the user specifies another AGENT_ID.
   # Do NOT use hostname or machine name.
   source .env 2>/dev/null
   if [ -z "$AGENT_ID" ]; then
     echo "AGENT_ID is not set. Ask the user for an agent identifier, or default to devbox2-codex in this environment (otherwise use <harness>-<model>)."
   fi

   # Check if already claimed
   gh issue view <number> --json labels --jq '.labels[].name' | grep -q "in-progress" && echo "SKIP — already claimed" && exit 1

   # Claim it — label + project roadmap status
   gh issue edit <number> --add-label "in-progress"

   # Update project roadmap: ensure the issue is on the AgentV OSS board,
   # then set status to "In progress" and stamp Agent ID
   ITEM_ID=$(gh project item-list 1 --owner EntityProcess --format json | jq -r '.items[] | select(.content.number == <number> and .content.repository == "EntityProcess/agentv") | .id')
   if [ -z "$ITEM_ID" ] || [ "$ITEM_ID" = "null" ]; then
     ITEM_ID=$(gh project item-add 1 --owner EntityProcess --url "https://github.com/EntityProcess/agentv/issues/<number>" --format json | jq -r '.id')
   fi
   if [ -n "$ITEM_ID" ]; then
     gh project item-edit --project-id PVT_kwDOAIbbRc4BSmjF --id "$ITEM_ID" --field-id PVTSSF_lADOAIbbRc4BSmjFzhAFomw --single-select-option-id c3991b20
     gh project item-edit --project-id PVT_kwDOAIbbRc4BSmjF --id "$ITEM_ID" --field-id PVTF_lADOAIbbRc4BSmjFzhAHSnk --text "$AGENT_ID"
   fi
   ```
   If the issue has the `in-progress` label, **do not work on it** — pick a different issue.

2. **Update local `main` to the latest `origin/main`** before branching:
   ```bash
   git checkout main
   git pull --ff-only origin main
   ```

3. **Create a worktree** with a feature branch:
   ```bash
   git worktree add agentv.worktrees/<branch-name> -b <type>/<issue-number>-<short-description>
   cd agentv.worktrees/<branch-name>
   bun install
   cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
   # Example: git worktree add agentv.worktrees/feat/42-add-new-embedder -b feat/42-add-new-embedder
   ```

   The feature branch must be based on the freshly updated `main`, not a stale local checkout.

4. **After your first commit, push and open a draft PR immediately:**
   ```bash
   git push -u origin <branch-name>
   gh pr create --draft --title "<type>(scope): description" --body "Closes #<issue-number>"
   ```
   Do NOT wait until implementation is complete. The draft PR is a handoff artifact — if the session is interrupted, the user or another agent can pick up where you left off.

5. **Implement the changes.** Commit and push incrementally as you work. Every meaningful checkpoint (feature compiles, tests pass, new behavior added) should be pushed to the draft PR so progress is visible and recoverable.

6. **Complete E2E verification** (see "Completing Work — E2E Checklist") — this is BLOCKING. Do NOT mark the PR ready for review until every step of the E2E checklist has passed and evidence is documented in the PR body. Specifically:
   1. Run unit tests.
   2. Execute every test plan item from the issue/PR checklist, mark each `[x]`, and paste CLI output as evidence.
   3. Manual red/green UAT with before/after evidence.
   4. **After e2e passes**, spawn a final subagent code review pass and address or call out any findings. Do NOT run the code review before e2e — if e2e fails you'll need to fix it first, which invalidates the review.
   5. CI pipeline passes (all checks green).
   6. No merge conflicts with `main`.

7. **Only after verification is complete**:
   - Mark the draft PR ready for review, or
   - Merge directly if the change is low risk and the repo policy allows it

8. **After merge, clean up local state**:
   - Delete the local feature branch
   - Remove the local worktree created for the issue
   - Confirm the primary checkout is back on an up-to-date `main`

The `in-progress` label stays on the issue until the PR is merged and the issue is closed. Do not remove it manually.

**IMPORTANT:** Never push directly to `main`. Always use branches and PRs.

### Tracker Conventions

- The roadmap project is the source of truth for prioritization.
- Issues in the roadmap are prioritized; issues outside it are not.
- `bug` marks defects.
- Issues without `bug` are non-bug work by default.
- `in-progress` marks an issue as claimed by an agent — do not start work on it.
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

After creating a worktree, always run setup:
```bash
bun install                                    # worktrees do NOT share node_modules
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env    # required for e2e tests and LLM operations
```
Both steps are required before running builds, tests, or evals in the worktree.

### After Checking Out an Existing Branch or PR

Whenever you `git checkout`, `gh pr checkout`, `git pull`, or otherwise switch to a ref that may have changed `package.json` / `bun.lock`, run `bun install` before building, testing, or pushing. The pre-push hook builds all workspaces — if dependencies are stale, the push fails with errors like `Cannot find module 'recharts'` even though the source change is unrelated. `bun install` is cheap when already up-to-date, so run it by default after any ref switch.

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

