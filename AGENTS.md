# Repository Guidelines

This is a TypeScript monorepo for AgentV - an AI agent evaluation framework.

## Tech Stack & Tools
- **Language:** TypeScript 5.x targeting ES2022
- **Runtime:** Bun (use `bun` for all package and script operations)
- **Build System:** Turbo (monorepo task orchestration)
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