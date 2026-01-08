## Context

AgentV supports multiple evaluator types. In particular:
- `llm_judge` runs in-process and can call the configured `judgeProvider`.
- `code_judge` runs as an external script (stdin/stdout), so it cannot directly access the in-process `judgeProvider` object.

This boundary blocks a class of evaluators that need **multiple LLM/judge calls per eval case** (N calls), including (but not limited to) RAG retrieval-ranking metrics.

### Motivating example: Contextual Precision (RAG)

Contextual Precision evaluates whether a retrieval system ranks *relevant* context chunks early.

High-level approach:
1. For each retrieved chunk at position $k$, ask an LLM judge: “Is this chunk relevant to the query?”
2. Compute a position-weighted precision score across the ranked list.

Key property: it requires **N independent relevance judgments** (one per chunk) to compute the metric faithfully.

Why this belongs in `code_judge` (not a new built-in evaluator):
- It is a niche metric (RAG retrieval evaluation) rather than a universal primitive.
- The scoring logic is straightforward to implement in userland once multi-call judge access exists.

Peer precedent exists (e.g., DeepEval, Ragas), but AgentV’s design principles still favor keeping this as a plugin/example evaluator.

## Goals / Non-Goals

Goals:
- Allow a `code_judge` script to invoke the **configured judge target** (same routing/credentials) without exposing provider credentials to the script.
- Keep this capability opt-in per evaluator.
- Provide guardrails: auth, loopback-only binding, call limit.

Non-Goals:
- No sandboxing or “safe execution” for arbitrary scripts.
- No guarantee that scripts won’t exfiltrate prompts/outputs (scripts are arbitrary code).
- No broad “provider API surface” (embeddings, files, tools) beyond what is required for judge invocations.
- No new evaluator type (we are explicitly sticking with the existing `code_judge` extension point).

## Decisions

### Decision: Use a local judge proxy (recommended)

When a `judge` config block is present on a `code_judge` evaluator, the runtime starts a local HTTP server bound to `127.0.0.1` (or `localhost`) and generates a random bearer token.

The runtime passes only:
- `AGENTV_JUDGE_PROXY_URL`
- `AGENTV_JUDGE_PROXY_TOKEN`

The script calls the proxy to request judge invocations. The proxy forwards requests to `context.judgeProvider.invoke(...)` (or `invokeBatch` when available).

Rationale:
- Keeps provider secrets inside the runtime process.
- Enables consistent model routing.
- Allows the runtime to enforce limits (e.g., max calls) and attribute costs to the evaluation.

### How this unblocks multi-call evaluators

This makes it feasible to implement, as `code_judge` scripts:
- Contextual Precision (N relevance calls + position-weighted scoring)
- Hybrid evaluators (deterministic checks + 1..N judge calls)
- Multi-aspect scoring (several judge prompts, combined/weighted)

### Efficiency: Prefer batch prompts over N calls

Deepeval's contextual precision implementation uses a **single LLM call** that returns an array of verdicts (one per retrieval context node), rather than N separate calls. This is significantly more efficient.

Scripts can achieve this pattern by:
1. Constructing a batch prompt that asks for all verdicts in one response
2. Using structured output (JSON array) to parse multiple verdicts

The proxy's `/invokeBatch` endpoint is optional but recommended for scripts that need to make multiple independent judge calls. For the common case of "evaluate N items and return verdicts," a single well-crafted prompt is preferred.

### Rejected: Passing provider credentials via env vars

Passing API keys to arbitrary scripts is high risk:
- A script can exfiltrate credentials.
- Budgets and observability become harder to enforce.
- It encourages scripts to call providers directly (bypassing configured behavior).

This approach remains possible for users (BYO keys) but is not the recommended built-in mechanism.

### Considered: Provide judge target name only

Passing only the judge *target name* (or a list of targets) to a script does not, by itself, enable invocation. An external process still needs either:
- credentials (which we do not want to pass), or
- an IPC mechanism (which is what the proxy provides).

### Considered: New in-process evaluator type

An alternative would be introducing a new evaluator type that runs in-process (sometimes described as an “agent_judge”). This would be a larger architecture change, expands the core surface area, and is not necessary for enabling multi-call patterns given `code_judge` already exists.

## Proxy API (minimal)

### Auth
- Every request MUST include `Authorization: Bearer <token>`
- Token is unique per evaluator invocation and not reused.

### Endpoint: Invoke
`POST /invoke`

Request:
```json
{
  "evalCaseId": "string",
  "attempt": 1,
  "question": "string",
  "systemPrompt": "string"
}
```

Response:
```json
{
  "outputMessages": [],
  "rawText": "string?"
}
```

Notes:
- `outputMessages` mirrors the provider output message model used elsewhere in AgentV.
- `rawText` is optional convenience (e.g., last assistant message) if inexpensive to compute.

### Payload scope

The proxy API is intentionally minimal:
- It is not a general provider client.
- It is designed to support “judge-like” prompts used for evaluation.

### Optional endpoint: Invoke batch
`POST /invokeBatch`

Request:
```json
{
  "requests": [ { "evalCaseId": "...", "attempt": 1, "question": "...", "systemPrompt": "..." } ]
}
```

Response:
```json
{ "responses": [ { "outputMessages": [], "rawText": "string?" } ] }
```

## Limits / Guardrails

- `judge.max_calls` limits the number of proxy invocations per `code_judge` execution.
- **Default `max_calls`: 50** — enforced even when not configured.
- The proxy MUST bind to loopback only.
- The proxy MUST be shut down after the evaluator finishes.

Additional guardrail guidance:
- The proxy SHOULD reject requests once the evaluator process exits.
- The proxy SHOULD fail closed if auth is missing/invalid.

## Observability

- The runtime SHOULD record proxy metadata in the evaluator output:
  - judge target name
  - number of proxy calls
  - whether batch was used

This keeps cost/latency attribution possible without leaking credentials to scripts.

## Open Questions

- Should the proxy expose `invokeBatch` in v1, or only `invoke`?
- Should the runtime enforce per-call timeout beyond the evaluator’s overall timeout?
- Should prompts/responses be redacted in logs by default?
