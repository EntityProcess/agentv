# Design: Target Proxy Enhancement

## Current Architecture

```
CLI (--target flag)
    ↓
orchestrator.ts
    ↓ creates provider for target
code-evaluator.ts
    ↓ creates proxy with single provider
target-proxy.ts (HTTP server)
    ↓ all calls go to one provider
evaluator script (via createTargetClient)
```

**Key files:**
- `packages/core/src/evaluation/orchestrator.ts` - creates providers, runs evaluators
- `packages/core/src/evaluation/evaluators/code-evaluator.ts` - spawns script, manages proxy
- `packages/core/src/runtime/target-proxy.ts` - HTTP proxy server
- `packages/eval/src/target-client.ts` - SDK client for scripts

## Target Selection (Current)

Targets are defined in `agentv.config.yaml`:
```yaml
targets:
  claude_base:
    provider: anthropic
    model: claude-sonnet-4-20250514
  gpt4o:
    provider: openai
    model: gpt-4o
    judge_target: claude_base  # Use claude for evaluating this target
```

The `judge_target` field specifies which target the proxy should use when evaluating this target. If not set, uses the same target being evaluated.

## Proposed Architecture

```
CLI (--target flag)
    ↓
orchestrator.ts
    ↓ creates providers for ALL configured targets
    ↓ passes provider map to code evaluator
code-evaluator.ts
    ↓ creates proxy with provider resolver
target-proxy.ts (HTTP server with /info, target override)
    ↓ resolves target name → provider
evaluator script (via createTargetClient with getInfo/target param)
```

## Type Changes

### target-proxy.ts

```typescript
// Old
interface TargetProxyOptions {
  readonly targetProvider: Provider;
  readonly maxCalls: number;
}

// New
interface TargetProxyOptions {
  readonly defaultProvider: Provider;
  readonly providers: ReadonlyMap<string, Provider>;  // All available targets
  readonly maxCalls: number;
}

// New request field
interface TargetProxyInvokeRequest {
  // ... existing fields
  readonly target?: string;  // Optional target override
}

// New endpoint response
interface TargetProxyInfoResponse {
  readonly targetName: string;      // Default target name
  readonly maxCalls: number;
  readonly callCount: number;
  readonly availableTargets: readonly string[];  // All target names
}
```

### target-client.ts

```typescript
// New request field
interface TargetInvokeRequest {
  // ... existing fields
  readonly target?: string;  // Optional target override
}

// New interface method
interface TargetClient {
  invoke(request: TargetInvokeRequest): Promise<TargetInvokeResponse>;
  invokeBatch(requests: readonly TargetInvokeRequest[]): Promise<readonly TargetInvokeResponse[]>;
  getInfo(): Promise<TargetInfo>;  // NEW
}

interface TargetInfo {
  readonly targetName: string;
  readonly maxCalls: number;
  readonly callCount: number;
  readonly availableTargets: readonly string[];
}
```

### code-evaluator.ts

Currently receives single provider. Needs to receive provider map from orchestrator:

```typescript
// Add to CodeEvaluatorOptions
interface CodeEvaluatorOptions {
  // ... existing
  readonly allProviders?: ReadonlyMap<string, Provider>;  // For target override
}
```

## Implementation Order

1. **target-proxy.ts** - Add `/info` endpoint, change options to accept provider map, implement target resolution
2. **code-evaluator.ts** - Pass provider map to proxy (requires orchestrator change)
3. **orchestrator.ts** - Create all providers, pass to code evaluator
4. **target-client.ts** - Add `getInfo()` method and `target` parameter
5. **Tests and docs**

## Error Handling

When unknown target is specified:
```json
{
  "error": "Unknown target 'foo'. Available: claude_base, gpt4o, gemini"
}
```

## Backwards Compatibility

- Existing evaluators without `target` parameter continue to work (use default)
- Existing proxy creation with single provider still works (wrap in map internally)
