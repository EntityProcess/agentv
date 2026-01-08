## 1. Core: Add /info endpoint to target proxy

- [x] 1.1 Add `GET /info` endpoint to `target-proxy.ts` returning `{ targetName, maxCalls, callCount, availableTargets }`
- [x] 1.2 Ensure `/info` requires bearer token authentication (same as other endpoints)
- [x] 1.3 Add unit tests for `/info` endpoint

## 2. Core: Support target override in invoke requests

- [x] 2.1 Modify `createTargetProxy` to accept a target resolver function (not just single provider)
- [x] 2.2 Add optional `target` field to `TargetProxyInvokeRequest`
- [x] 2.3 Implement target resolution: use specified target or fall back to default
- [x] 2.4 Return HTTP 400 with available targets list when unknown target is specified
- [x] 2.5 Update `code-evaluator.ts` to pass target resolver to proxy
- [x] 2.6 Add unit tests for target override behavior

## 3. SDK: Update @agentv/eval client

- [x] 3.1 Add `getInfo()` method to `TargetClient` interface
- [x] 3.2 Add optional `target` field to `TargetInvokeRequest`
- [x] 3.3 Implement `getInfo()` in client (calls `/info` endpoint)
- [x] 3.4 Update `invoke()` and `invokeBatch()` to pass `target` when provided
- [x] 3.5 Add/update unit tests for new client capabilities

## 4. Documentation

- [x] 4.1 Update `code-judge-with-llm-calls` example README with target override usage
- [x] 4.2 Update `custom-evaluators.md` skill reference with new capabilities
- [x] 4.3 Add example showing target override use case

## 5. Verification

- [x] 5.1 `bun run build`
- [x] 5.2 `bun run typecheck`
- [x] 5.3 `bun run lint`
- [x] 5.4 `bun test`
