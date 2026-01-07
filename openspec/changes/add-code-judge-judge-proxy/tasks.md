## 1. Schema + Loader

- [x] 1.1 Extend YAML schema to accept `judge?: { max_calls?: number }` on `code_judge`
- [x] 1.2 Update evaluator parsing/types to plumb the `judge` config into the runtime

## 2. Core: Judge Proxy

- [x] 2.1 Add env injection support for subprocess execution (pass `env` into spawn)
- [x] 2.2 Implement a loopback-only HTTP judge proxy server with bearer token auth
- [x] 2.3 In `CodeEvaluator`, when `judge` config is present and a judge provider is available:
  - start proxy
  - set `AGENTV_JUDGE_PROXY_URL` + `AGENTV_JUDGE_PROXY_TOKEN` for the child process
  - enforce `max_calls` (default limit)
  - shut down proxy on completion
- [x] 2.4 Record proxy usage metadata in evaluator output (target name, call count)

## 3. SDK: @agentv/eval

- [x] 3.1 Add `createJudgeProxyClient()` (reads proxy URL/token from env vars)
- [x] 3.2 Expose a minimal API for scripts: `invoke({ systemPrompt, question })` and optional `invokeBatch([...])`
- [x] 3.3 Add unit tests for env parsing + error cases

## 4. Examples + Docs

- [x] 4.1 Add a TypeScript example: `contextual-precision.ts`
  - Demonstrates RAG retrieval ranking evaluation
  - Uses single batch prompt returning JSON array of verdicts (efficient pattern)
  - Calculates weighted cumulative precision score
  - Shows `@agentv/eval` client usage
- [x] 4.2 Update the custom evaluator docs to describe `judge` config and security constraints

## 5. Cleanup

- [x] 5.1 Remove `code_snippets` field (domain-specific, unused)
  - Use `expected_messages.tool_calls` for retrieval context instead
  - Removed from: yaml-parser, types, code-evaluator, prompt-builder, schemas

## 6. Verification

- [x] 6.1 `bun run build`
- [x] 6.2 `bun run typecheck`
- [x] 6.3 `bun run lint`
- [x] 6.4 `bun test`
