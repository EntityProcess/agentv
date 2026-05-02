# Spike: pi-ai migration — path selection

Tracks #1205. This doc captures the spike findings before any provider is ported.
Once the implementation path is chosen and the spike port lands, delete this file.

## Initial assumption (wrong)

Original assumption: `Provider.invoke(request) -> response` is the contract every
grader call site uses, so we can swap the implementation behind `invoke()` from
Vercel `generateText` to pi-ai `complete()` and call it a day.

## Actual call graph

`asLanguageModel(): import('ai').LanguageModel` is part of the `Provider`
interface (`providers/types.ts:307-309`) and is the load-bearing entry point for
every real grader path. The consumers don't go through `provider.invoke()`:

| Consumer | What it does |
| --- | --- |
| `graders/llm-grader.ts:485` | `provider.asLanguageModel()` → `generateText({ model, tools: fsTools, stopWhen: stepCountIs(...) })` (built-in agent mode with sandboxed filesystem tools and multi-step) |
| `graders/llm-grader.ts:1106` | `asLanguageModel()` → `generateText({ model, messages })` (LLM-judge mode) |
| `graders/composite.ts:343` | `asLanguageModel()` → `generateText({ model, messages })` |
| `generators/rubric-generator.ts:35` | `asLanguageModel()` → `generateText({ model, messages })` |
| `providers/agentv-provider.ts:73-84` | `invoke()` throws; `asLanguageModel()` is the only supported path |

`provider.invoke()` exists and is implemented in `ai-sdk.ts:invokeModel`, but the
grader hot paths bypass it. They depend on the Vercel `LanguageModel` *type*,
not on AgentV's `Provider` abstraction.

This means a pi-ai migration is a real refactor, not a one-file swap.

## Two viable paths

### Path A — Vercel LanguageModelV2 shim over pi-ai

Implement Vercel's `LanguageModelV2` interface (the contract `generateText`
expects) as an adapter around pi-ai's `complete()` / `stream()`. `asLanguageModel()`
keeps returning a `LanguageModel`; no consumer changes.

**Pros**
- Zero changes to `llm-grader`, `composite`, `rubric-generator`, `agentv-provider`.
- Migration is incremental — port one provider at a time, others keep using ai-sdk.
- Tool-definition shape (Zod via `tool()`) stays as-is in graders.

**Cons**
- Have to implement Vercel's V2 spec faithfully — stream parts, tool-call deltas,
  finish reasons, usage metadata, provider-specific options pass-through.
- `ai` and `@ai-sdk/*` peer types stay as a dev/runtime dep (we still import the
  V2 interface) — partial dependency reduction, not full removal.
- Adapter layer is non-trivial code to maintain; bugs in the shim show up as
  weird grader behavior.

**Spike work to validate**: build a minimal `LanguageModelV2` shim around
pi-ai's `complete()` for non-streaming, non-tool calls. Run the rubric-generator
through it against the existing baselines. If that works, the shim is viable;
streaming + tool-call deltas are the next risk areas.

### Path B — Replace `asLanguageModel` with a richer `Provider` API

Drop `asLanguageModel()` from the `Provider` interface. Add what consumers
actually need to `invoke()`: tool calling, multi-step (`stopWhen`-equivalent),
structured-output bias. Migrate the four consumers to call `provider.invoke()`.

**Pros**
- Removes `ai` / `@ai-sdk/*` from the internal type surface entirely.
- `Provider` becomes a real abstraction, not a thin Vercel passthrough.
- Tool definitions can move to TypeBox (pi-ai native) and stop dragging Zod via
  the AI-SDK `tool()` helper.

**Cons**
- All four consumers change. Bigger blast radius, more baseline runs needed.
- Have to design a tool-calling shape that survives ai-sdk → pi-ai mapping
  (and any future provider lib swap).
- More surface for behavior drift between old and new code paths.

**Spike work to validate**: sketch the new `Provider.invoke()` signature
covering the multi-step + tools case used by `llm-grader.ts:485-540`, and port
*one* consumer (rubric-generator is the simplest — no tools, no multi-step) to
prove the ergonomics.

## Recommendation

Lean **Path A** for the spike, with a clear exit criterion: if the
`LanguageModelV2` shim explodes in scope (tool-call deltas, stream parts), pivot
to Path B before merging. Path A's appeal is that it lets the migration happen
in one provider at a time without churning grader code; Path B is a cleaner
endpoint but a much larger initial PR.

## Out-of-scope for this spike

- Anthropic thinking-budget mapping (numeric → bucket) — design separately.
- Custom retry/backoff (`ai-sdk.ts:520-559`) — port wholesale, evaluate
  trimming in a follow-up.
- Token-usage object shape changes — preserve the current `tokenUsage` fields
  for JSONL compatibility regardless of which path we pick.
- Streaming support — current consumers don't stream; defer.
