# Spike: pi-ai migration — Path B selected

Tracks #1205. This doc captures the spike findings and the chosen migration
path. Once the spike port lands, delete this file and fold any user-relevant
content into module headers / the issue.

## Decision: Path B

We're going with Path B — drop `asLanguageModel()` from the `Provider` interface
and enrich `Provider.invoke()` to cover the full grader hot path (multi-step +
tools). The four consumers migrate to the new API.

**Why not Path A** (Vercel `LanguageModelV2` shim over pi-ai): A is a shim, not
an abstraction. With A our `Provider` interface stays a thin facade — we'd be
implementing Vercel's contract on top of pi-ai, and every consumer would still
depend on Vercel's API surface. The next time we want to swap LLM libs, A leaves
the consumer-side coupling untouched. B fixes the coupling: `Provider` becomes
the real boundary, consumers depend on AgentV's own API, and only provider
implementations change when the underlying lib changes.

The cost is honest: bigger initial PR (4 consumer changes vs. 1 shim), more
baseline runs. But if we're spending the migration budget anyway, spend it on
the change that leaves the codebase better.

## Initial assumption (wrong)

Original assumption: `Provider.invoke(request) -> response` is the contract every
grader call site uses, so we can swap the implementation behind `invoke()` from
Vercel `generateText` to pi-ai `complete()` and call it a day.

## Actual call graph

`asLanguageModel(): import('ai').LanguageModel` is part of the `Provider`
interface (`providers/types.ts:309`) and is the load-bearing entry point for
every real grader path. The consumers don't go through `provider.invoke()`:

| Consumer | What it does | Tools? | Multi-step? |
| --- | --- | --- | --- |
| `graders/llm-grader.ts:485` (built-in agent) | `asLanguageModel()` → `generateText({ model, system, prompt, tools, stopWhen, temperature })` | yes (3 sandboxed FS tools) | yes (`stepCountIs(maxSteps)`) |
| `graders/llm-grader.ts:1106` (LLM-judge) | `asLanguageModel()` → `generateText({ model, messages })` | no | no |
| `graders/composite.ts:343` | `asLanguageModel()` → `generateText({ model, messages })` | no | no |
| `generators/rubric-generator.ts:35` | `asLanguageModel()` → `generateText({ model, messages })` | no | no |
| `providers/agentv-provider.ts:73-84` | `invoke()` actively throws "use asLanguageModel() instead" | — | — |

The `built-in agent` case in `llm-grader.ts:485` is the hardest consumer — any
new `Provider` API has to cover its full surface or we end up with two ways to
call providers.

## New `Provider.invoke()` design

### Goals

- One `invoke()` shape covers single-shot, judged-message, and tool-using
  multi-step calls.
- Tool schema language is provider-library-neutral (JSON Schema on the wire).
- Existing fields (`question`, `chatPrompt`, `temperature`, `maxOutputTokens`,
  `signal`, `evalCaseId`, `attempt`, etc.) stay as-is — additive change.
- Existing `ProviderResponse` fields (`output`, `tokenUsage`, `costUsd`,
  `durationMs`, `startTime`, `endTime`) stay as-is.

### Additions to `ProviderRequest`

```ts
export interface ProviderTool {
  /** Tool name as shown to the model. */
  readonly name: string;
  /** Tool description as shown to the model. */
  readonly description: string;
  /** JSON Schema for the tool's input. Pi-ai TypeBox compiles to JSON Schema; Zod
   * compiles via zod-to-json-schema. Provider implementations translate to the
   * underlying lib's native shape (TypeBox object for pi-ai). */
  readonly parameters: JsonObject;
  /** Executes the tool. Receives parsed JSON input, returns a JSON-serializable
   * result. Errors are caught and surfaced to the model as tool-error results. */
  execute(input: unknown): Promise<unknown>;
}

export interface ProviderRequest {
  // ...existing fields unchanged...

  /** Tools the model may call. Provider runs the agent loop, calling
   * tool.execute() for each tool call until either the model returns no
   * further tool calls or `maxSteps` is reached. */
  readonly tools?: readonly ProviderTool[];

  /** Maximum number of agent loop iterations (model turn + tool execution =
   * one step). Required when `tools` is non-empty. Ignored otherwise. */
  readonly maxSteps?: number;
}
```

### Additions to `ProviderResponse`

```ts
export interface ProviderStepInfo {
  /** Number of agent loop steps executed (0 if no tools were used). */
  readonly count: number;
  /** Total tool calls across all steps. */
  readonly toolCallCount: number;
}

export interface ProviderResponse {
  // ...existing fields unchanged...

  /** Populated when the request used tools. Undefined for single-shot calls. */
  readonly steps?: ProviderStepInfo;
}
```

This is the minimum llm-grader's `built-in` mode actually needs from
`generateText`'s richer `steps[]` array (see `llm-grader.ts:524`). If a future
consumer needs per-step detail (which tool, what input, what output), promote
`ProviderStepInfo` then — YAGNI for now.

### Removed

- `Provider.asLanguageModel?(): import('ai').LanguageModel` — gone.
- `import('ai').LanguageModel` reference in `providers/types.ts:309` — gone.
- `agentv-provider.ts`'s `invoke()`-throws-by-design — `agentv` becomes a
  normal `Provider` that runs through `invoke()` like the others.

### Tool schema neutrality

JSON Schema on the wire keeps consumers free to author tools with whatever
schema lib they want. The two grader call sites today use Zod via ai-sdk's
`tool()` helper; under Path B they'd switch to **TypeBox** (pi-ai native, no
extra conversion step). That's a small port — three filesystem tools in
`llm-grader.ts:1473-1554`. Provider implementations are responsible for
translating `ProviderTool.parameters` (JSON Schema) → the underlying lib's
expected shape.

## Consumer migration order

Smallest blast radius first so we can flush the design through real code before
touching the hardest case:

1. **`rubric-generator.ts`** — single-shot, no tools. Simplest possible exercise
   of `provider.invoke({ chatPrompt: [...] })`. Validates token usage + response
   text plumbing.
2. **`composite.ts`** — same shape as rubric-generator. Smoke test that the API
   works for a second consumer.
3. **`llm-grader.ts:1106`** (LLM-judge mode) — same shape again, different
   prompt construction.
4. **`llm-grader.ts:485`** (built-in agent mode) — exercises `tools` +
   `maxSteps`. The whole point of the new API.
5. **`agentv-provider.ts`** — collapse the `invoke()`-throws path. Provider
   becomes a normal pi-ai-backed implementation.

After step 5, `asLanguageModel?` can be removed from the `Provider` interface
and `import { generateText } from 'ai'` disappears from grader code.

## Provider implementation order

After consumers compile against the new interface, port providers one at a time:

1. **OpenAIProvider** — pi-ai native, simplest. Run grader-score baselines.
2. **OpenRouterProvider** — pi-ai treats it as an OpenAI-compatible endpoint;
   should fall out of step 1 with config differences only.
3. **GeminiProvider** — pi-ai native (`google` provider).
4. **AnthropicProvider** — pi-ai native, but thinking-budget mapping needs
   design (see open question below).
5. **AzureProvider** — pi-ai has `azure-openai-responses.js`; verify the
   `useDeploymentBasedUrls` + `apiFormat` cases.

Each step ends with: build green, lint green, baselines re-run for an eval that
exercises that provider.

## Open design questions

- **Anthropic thinking-budget mapping.** ai-sdk takes a numeric `budgetTokens`;
  pi-ai exposes a 5-bucket `reasoning` enum (`minimal|low|medium|high|xhigh`).
  Lossy. Pick one of: (a) coerce numeric → bucket via thresholds, (b) drop the
  knob to a bucket-only YAML field with deprecation warning, (c) bypass pi-ai's
  abstraction and pass through to its Anthropic provider directly. Decide
  before porting `AnthropicProvider`.
- **Retry/backoff.** `ai-sdk.ts:520-559` has bespoke exponential backoff with
  configurable status-code list. pi-ai's behavior differs. Likely answer: keep
  the existing `withRetry` wrapper around `provider.invoke()`'s underlying
  pi-ai call — the retry logic is library-agnostic. Confirm in step 1.
- **Token-usage object shape.** pi-ai returns `{input, output, cost}`; ai-sdk
  surfaces `{inputTokens, outputTokens, cachedInputTokens, reasoningTokens}`.
  Map to the existing `ProviderTokenUsage` shape (`input`, `output`, optional
  `cached`, optional `reasoning`) — which is already what consumers see today.
  Cost goes to the existing `costUsd` field.

## Out-of-scope for this spike

- Anthropic thinking-budget mapping resolution (call it out, design separately).
- Streaming support — current consumers don't stream; defer.
- Adding new providers exposed by pi-ai (Bedrock, Vertex, Mistral, etc.) — this
  PR ports the existing 5, no more.
- Orchestrator-side changes (agent provider kinds, batching) — untouched.
