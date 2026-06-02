# AgentV Repository Guidelines

This is a TypeScript monorepo for AgentV, an AI agent evaluation framework.

## Load Skills First

Keep this file as bootstrap context. Detailed AgentV playbooks live in committed skills under `.agents/skills/`, following the Phoenix-style repo skill layout. `.claude/skills` is a symlink to the same directory for Claude compatibility.

Before non-trivial work, load the relevant skill:

- `agentv-core-development`: core design principles, TypeScript conventions, naming, snake_case wire formats, docs, examples, and repo structure.
- `agentv-testing-verification`: CLI testing, Studio/browser verification, grader e2e checks, pre-push hooks, and PR readiness evidence.
- `agentv-git-workflow`: Beads/GitHub workflow, worktrees, issue claiming, draft PRs, pushing, merging, and cleanup.
- `agentv-grader-changes`: grader/evaluator type changes, score output, baselines, live eval verification, and score-range checks.
- `agentv-release-publishing`: versioning, release automation, and package publishing.

## Always-On Rules

- Use Bun for all package and script operations.
- Run Python scripts with `uv run <script.py>`.
- Internal TypeScript uses `camelCase`; anything crossing a process boundary uses `snake_case`. Translate at the boundary.
- Keep AgentV core lightweight. Prefer existing primitives, plugins, examples, and docs over new built-ins.
- Do not use global `agentv` for CLI testing. Use `bun apps/cli/src/cli.ts <args>`; rebuild first when `packages/core/` changes.
- For Studio UI verification, rebuild `apps/studio/dist/` before UAT or screenshots.
- For non-trivial repo changes, work in a fresh sibling worktree under `../agentv.worktrees/` based on latest `origin/main`. Keep the primary checkout clean; do not do feature work in the main folder.
- Never push directly to `main`. Push feature branches and open/update draft PRs.
- Use conventional commit and PR titles: `type(scope): summary`.
- Do not create markdown TODO lists or memory files. Beads is the canonical task tracker and agent memory.

## Key Paths

- `packages/core/`: evaluation engine, providers, grading, registry, programmatic API.
- `packages/eval/`: lightweight assertion SDK.
- `apps/cli/`: CLI published as `agentv`.
- `apps/studio/`: Studio frontend.
- `apps/web/`: documentation site.
- `examples/`: documentation and integration coverage.
- `.agents/skills/`: committed coding-agent skills.

<!-- BEGIN BEADS INTEGRATION v:1 profile:full hash:f65d5d33 -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Quality
- Use `--acceptance` and `--design` fields when creating issues
- Use `--validate` to check description completeness

### Lifecycle
- `bd defer <id>` / `bd supersede <id>` for issue management
- `bd stale` / `bd orphans` / `bd lint` for hygiene
- `bd human <id>` to flag for human decisions
- `bd formula list` / `bd mol pour <name>` for structured workflows

### Auto-Sync

bd automatically syncs via Dolt:

- Each write auto-commits to Dolt history
- Use `bd dolt push`/`bd dolt pull` for remote sync
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- END BEADS INTEGRATION -->

## AgentV Beads Workflow Overrides

The Beads block above is managed by `bd setup codex`. For this repository, keep these local rules in addition to the generated Beads workflow:

- Beads is the canonical task tracker and agent memory for this project: it is the working brain for task state, dependencies, discoveries, and durable project knowledge.
- GitHub is the team collaboration surface: use it for draft PRs, reviews, CI, merge coordination, and communication with other parties.
- Interpret the generated "do not use external issue trackers" rule as "do not create a second private task brain." It does not replace this repo's GitHub PR, review, CI, and team communication workflow.
- After the first meaningful commit for Beads-backed work, push the branch and open a draft PR. Continue pushing incremental commits to that draft PR so work is visible and recoverable before merge.
- Before ending a work session, sync Beads with `bd dolt push`, push committed code with `git push`, and confirm the branch is up to date with its remote.
- Do not create markdown TODO lists or separate memory files. Use `bd create` for follow-up work and `bd remember "insight"` for durable project memory.
