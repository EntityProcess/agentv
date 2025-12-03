# Change: Switch to Vercel AI SDK and Remove Ax Dependency

## Why

AgentV currently depends on `@ax-llm/ax` for Azure OpenAI, Anthropic, and Gemini providers.
This adds an extra abstraction layer, complicates provider configuration, and diverges from
the ecosystem-standard Vercel AI SDK already used in related projects.

## What Changes

- Replace Ax-based cloud LLM providers in `@agentv/core` with direct, per-provider
  integrations using the Vercel AI SDK (Azure OpenAI, Anthropic, and Gemini).
- Preserve existing `targets.yaml` schema, environment variable contracts, retry semantics,
  and the `multiturn-messages-lm-provider` behavior for `chatPrompt` handling.
- Remove the `@ax-llm/ax` runtime dependency from `@agentv/core` and all Ax-specific
  plumbing (types, helpers, diagnostics, `getAxAI` escape hatches).
- Keep a single, minimal abstraction seam: `ProviderRequest`/`ProviderResponse` and the
  `Provider` interface in `providers/types.ts`, with each concrete provider calling the
  Vercel AI SDK directly.
- Avoid introducing any new generic Vercel adapter layer or factory; adding a new
  cloud provider in future should be "copy an existing provider class and tweak
  configuration", not an architectural change.

## Impact

- Affected specs:
  - `evaluation` (Provider Integration, Provider Retry Configuration)
  - `multiturn-messages-lm-provider` (AxProvider Baseline Implementation)
- Affected code:
  - `packages/core/src/evaluation/providers/types.ts`
  - `packages/core/src/evaluation/providers/ax.ts`
  - `packages/core/src/evaluation/providers/targets.ts`
  - Any provider-specific files using Ax types or `getAxAI()`
  - Tests under `packages/core/test/evaluation/providers/*`
- Breaking changes:
  - Removal of the `getAxAI()` escape hatch from provider types (no direct Ax access).
  - Ax-specific diagnostics scripts will be retired or migrated to Vercel AI equivalents.
