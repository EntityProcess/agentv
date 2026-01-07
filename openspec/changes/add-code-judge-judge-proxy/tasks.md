## 1. Schema + Loader

- [ ] 1.1 Extend YAML schema to accept `use_judge_provider?: boolean` on `code_judge`
- [ ] 1.2 Extend YAML schema to accept `judge_provider?: { max_calls?: number }` on `code_judge`
- [ ] 1.3 Update evaluator parsing/types to plumb these fields into the runtime

## 2. Core: Judge Proxy

- [ ] 2.1 Add env injection support for subprocess execution (pass `env` into spawn)
- [ ] 2.2 Implement a loopback-only HTTP judge proxy server with bearer token auth
- [ ] 2.3 In `CodeEvaluator`, when `use_judge_provider` is enabled and a judge provider is available:
  - start proxy
  - set `AGENTV_JUDGE_PROXY_URL` + `AGENTV_JUDGE_PROXY_TOKEN` for the child process
  - enforce `max_calls` (default limit)
  - shut down proxy on completion
- [ ] 2.4 Record proxy usage metadata in evaluator output (target name, call count)

## 3. SDK: @agentv/eval

- [ ] 3.1 Add `createJudgeProxyClientFromEnv()` (or `useJudgeProvider()` implemented via proxy env vars)
- [ ] 3.2 Expose a minimal API for scripts: `invoke({ systemPrompt, question })` and optional `invokeBatch([...])`
- [ ] 3.3 Add unit tests for env parsing + error cases

## 4. Examples + Docs

- [ ] 4.1 Add a TypeScript example showing multi-call code_judge using proxy client
- [ ] 4.2 Update the custom evaluator docs to describe `use_judge_provider` and security constraints

## 5. Verification

- [ ] 5.1 `bun run build`
- [ ] 5.2 `bun run typecheck`
- [ ] 5.3 `bun run lint`
- [ ] 5.4 `bun test`
