# Cross-Repo Workspace

## Repositories

### agentevals/ (agentevals/agentevals)
Open standard spec + Starlight docs site at agentevals.io.
Must reflect agentv's (EntityProcess/agentv) capabilities.

Key docs paths:
- `docs/src/content/docs/specification/evaluators.mdx`
- `docs/src/content/docs/specification/eval-format.mdx`
- `docs/src/content/docs/specification/evalcase-schema.mdx`
- `docs/src/content/docs/patterns/`

### agentv/ (EntityProcess/agentv)
TypeScript/Bun evaluation framework. Reference implementation of the agentevals spec.
Source of truth — when agentv ships features, the agentevals spec must be updated.

Key source paths:
- `packages/core/src/evaluation/types.ts`
- `packages/core/src/evaluation/orchestrator.ts`
- `packages/core/src/evaluation/yaml-parser.ts`

## Sync Rules
- agentv evaluator changes → update `agentevals/docs/src/content/docs/specification/evaluators.mdx`
- agentv schema changes → update `agentevals/docs/src/content/docs/specification/eval-format.mdx` and `evalcase-schema.mdx`
- New patterns → update `agentevals/docs/src/content/docs/patterns/`
- Preserve existing Starlight/MDX formatting conventions
- Keep frontmatter intact when editing MDX files
