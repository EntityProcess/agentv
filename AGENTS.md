# Repository Guidelines

This is a TypeScript monorepo for AgentV - an AI agent evaluation framework.

## Tech Stack & Tools
- **Language:** TypeScript 5.x targeting ES2022
- **Package Manager:** pnpm 10.20.0 (use `pnpm` for all package operations)
- **Build System:** Turbo (monorepo task orchestration)
- **Bundler:** tsup (TypeScript bundler)
- **Testing:** Vitest
- **LLM Framework:** Vercel AI SDK
- **Validation:** Zod

## Project Structure
- `packages/core/` - Evaluation engine, providers, grading
- `apps/cli/` - Command-line interface (published as `agentv`)

## Essential Commands
- `pnpm install` - Install dependencies
- `pnpm build` - Build all packages
- `pnpm test` - Run tests
- `pnpm typecheck` - Type checking
- `pnpm lint` - Lint code
- `pnpm format` - Format with Prettier

## Functional Testing

When functionally testing changes to the AgentV CLI, **NEVER** use `agentv` directly as it may run the globally installed npm version. Instead:

- **From repository root:** Use `pnpm agentv <args>` to run the locally built version
- **From apps/cli directory:** Use `pnpm dev -- <args>` to run from TypeScript source with tsx

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

Always open `@/docs/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/docs/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->
