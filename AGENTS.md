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
- `code_judge` scripts for custom evaluation logic
- `llm_judge` evaluators with custom prompt files for domain-specific LLM grading
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

### 4. Non-Breaking Extensions
New fields should be optional. Existing configurations must continue working unchanged.

### 5. AI-First Design
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
- `apps/cli/` - Command-line interface (published as `agentv`)

## Quality Assurance Workflow

After making any significant changes (refactoring, new features, bug fixes), always run the following verification steps in order:

1. `bun run build` - Ensure code compiles without errors
2. `bun run typecheck` - Verify TypeScript type safety across the monorepo
3. `bun run lint` - Check code style and catch potential issues with Biome
4. `bun test` - Run all tests to verify functionality

Only consider the work complete when all four steps pass successfully. This ensures code quality, prevents regressions, and maintains the integrity of the codebase.

## Documentation Updates

When making changes to functionality (new features, modified behavior, new evaluator types, etc.), **always update the skill files and references** in the templates directory:

- **Source of truth**: `apps/cli/src/templates/.claude/skills/agentv-eval-builder/`
  - `skill.md` - Main skill instructions for AI agents
  - `references/*.md` - Detailed reference documentation (e.g., `custom-evaluators.md`, `structured-data-evaluators.md`)

These files are copied to the user's workspace when they run `agentv init`. They serve as the authoritative guide for AI agents helping users build evaluations.

**Do NOT duplicate content in README.md** - keep the README minimal and reference the skill files instead.

## Functional Testing

When functionally testing changes to the AgentV CLI, **NEVER** use `agentv` directly as it may run the globally installed npm version. Instead:

- **From repository root:** Use `bun agentv <args>` to run the locally built version
- **From apps/cli directory:** Use `bun dev -- <args>` to run from TypeScript source

This ensures you're testing your local changes, not the published npm package.

## TypeScript Guidelines
- Target ES2022 with Node 20+
- Prefer type inference over explicit types
- Use `async/await` for async operations
- Prefer named exports
- Keep modules cohesive

## Version Management
This project uses [Changesets](https://github.com/changesets/changesets) for automated versioning and changelog generation.

### Creating a changeset
When making changes that should be included in the next release:
1. Run `bun changeset` to create a new changeset file
2. Select the semver bump type (patch, minor, or major)
3. Write a summary of the changes for the changelog
4. Commit the generated `.changeset/*.md` file with your changes

### Releasing a new version
1. Run `bun version` to consume changesets and update package.json version
2. Review the updated CHANGELOG.md
3. Commit the version bump and changelog updates
4. Create a git tag and push to trigger release workflow

## Git Workflow

### Pull Requests
**Always use squash merge** when merging PRs to main. This keeps the commit history clean with one commit per feature/fix.

```bash
# Using GitHub CLI to squash merge a PR
gh pr merge <PR_NUMBER> --squash

# Or with auto-merge enabled
gh pr merge <PR_NUMBER> --squash --auto
```

Do NOT use regular merge or rebase merge, as these create noisy commit history with intermediate commits.

## Package Publishing
- Core package (`packages/core/`) - Core evaluation engine and grading logic (published as `@agentv/core`)
- CLI package (`apps/cli/`) is published as `agentv` on npm
- Uses tsup with `noExternal: ["@agentv/core"]` to bundle workspace dependencies
- Install command: `npm install -g agentv`

## Python Scripts
When running Python scripts, always use: `uv run <script.py>`

<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->