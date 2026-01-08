# Enhance Judge Proxy with Target Visibility and Control

## Summary

Add capabilities for code judge scripts to:
1. Query which target is being used for judge calls (visibility)
2. Override the target for specific invoke calls (control)

## Motivation

Currently, code judge scripts call `createJudgeProxyClient()` and make LLM calls without knowing which target/model is being used. This creates two problems:

1. **No visibility**: Script authors can't log or debug which model is evaluating their prompts
2. **No flexibility**: Can't use different models for different purposes (e.g., cheap model for simple checks, expensive model for nuanced evaluation)

## Proposed Changes

### 1. Add `/info` endpoint to judge proxy

Returns metadata about the proxy configuration:
```json
{
  "targetName": "claude-sonnet-4-20250514",
  "maxCalls": 50,
  "callCount": 3
}
```

### 2. Add optional `target` parameter to invoke requests

Allow overriding the target for specific calls:
```typescript
// Use default target
await judge.invoke({ question: "..." });

// Use specific target (must be configured in targets)
await judge.invoke({ question: "...", target: "gpt-4o-mini" });
```

### 3. Update SDK client

Add `getInfo()` method and `target` parameter support to the `@agentv/eval` SDK.

## Scope

- Modifies: `packages/core/src/runtime/judge-proxy.ts`
- Modifies: `packages/eval/src/judge-proxy-client.ts`
- Modifies: `packages/core/src/evaluation/evaluators/code-evaluator.ts`
- Updates: Documentation and examples

## Non-Goals

- No changes to YAML schema (existing `judge_target` on target definition remains)
- No new CLI commands
