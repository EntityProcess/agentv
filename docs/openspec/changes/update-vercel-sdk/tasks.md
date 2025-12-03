## 1. Specification Updates

- [ ] 1.1 Add MODIFIED requirements to `evaluation` capability for Vercel AI–based
      provider integration while preserving existing `targets.yaml` and env var contracts.
- [ ] 1.2 Add MODIFIED requirement to `multiturn-messages-lm-provider` to decouple
      chat prompt handling from Ax-specific types and name the shared chat prompt
      contract used by Vercel AI providers.

## 2. Provider Abstraction and Types

- [ ] 2.1 Keep `ProviderRequest`, `ProviderResponse`, and the `Provider` interface in
      `packages/core/src/evaluation/providers/types.ts` as the only abstraction seam,
      with no additional adapter or factory layer for Vercel AI.
- [ ] 2.2 Update `ProviderKind`, `Provider`, and related types to remove all Ax-specific
      references (including `AxAI` imports and the `getAxAI()` escape hatch) while
      keeping the rest of the surface stable for existing callers.
- [ ] 2.3 Ensure `ChatPrompt` is defined in a provider-agnostic way (no Ax types) and
      reused across all Vercel AI–backed providers via a shared chat-prompt builder.

## 3. Azure OpenAI, Anthropic, and Gemini Providers

- [ ] 3.1 Replace Ax-based Azure provider implementation with a Vercel AI SDK–backed
      `AzureProvider` that honors existing retry configuration and timeout behavior.
- [ ] 3.2 Replace Ax-based Anthropic provider implementation with a Vercel AI SDK–backed
      `AnthropicProvider`, including support for `thinkingBudget` where applicable or
      clearly documenting any limitations.
- [ ] 3.3 Replace Ax-based Gemini provider implementation with a Vercel AI SDK–backed
      `GeminiProvider` that preserves current model defaulting and env var semantics.
- [ ] 3.4 Ensure all three providers continue to use the shared chat prompt builder
      defined by the `multiturn-messages-lm-provider` capability.

## 4. Targets Resolution and Configuration

- [ ] 4.1 Keep `targets.yaml` parsing in `targets.ts` stable, including aliases and
      environment-variable interpolation for Azure, Anthropic, and Gemini.
- [ ] 4.2 Confirm that retry configuration (`max_retries`, `retry_status_codes`, etc.)
      still applies on top of Vercel AI calls and adjust error classification if
      necessary (e.g., mapping HTTP and network errors).
- [ ] 4.3 Add or update inline documentation for provider kinds to note the Vercel AI
      implementation detail and any new environment variables if introduced.

## 5. Dependency and Tooling Cleanup

- [ ] 5.1 Remove `@ax-llm/ax` from `packages/core/package.json` dependencies and delete
      `packages/core/src/evaluation/providers/ax.ts` once Vercel AI providers are wired.
- [ ] 5.2 Update `packages/core/README.md` and any docs that reference Ax to reflect
      the new Vercel AI SDK dependency.
- [ ] 5.3 Migrate or remove Ax-specific diagnostics scripts (e.g., `diagnostics:azure`)
      in favor of Vercel AI–based checks, or mark them as deprecated.

## 6. Testing and Validation

- [ ] 6.1 Update existing provider tests under
      `packages/core/test/evaluation/providers/` to mock the Vercel AI SDK instead of Ax
      while keeping behavior expectations identical.
- [ ] 6.2 Add regression tests covering multi-turn `chatPrompt` behavior for Azure,
      Anthropic, and Gemini using the new adapter (including guidelines handling and
      system message merging).
- [ ] 6.3 Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` from the repo root to
      validate the migration.
