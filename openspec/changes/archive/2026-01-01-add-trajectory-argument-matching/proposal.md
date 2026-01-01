# Change: Add Argument Matching to Tool Trajectory Evaluator

## Why

The current `tool_trajectory` evaluator only validates tool **names**, not their **arguments**. Argument validation is a core primitive for tool use evaluation. Without it, users cannot verify that agents pass correct parameters to tools.

This is a lightweight extension to an existing primitive - not domain logic. It aligns with Google ADK's trajectory evaluator which supports exact argument matching in EXACT mode.

## What Changes

- Extend `tool_trajectory` evaluator to support optional `args` matching in `expected` items
- Support two argument matching modes: **exact** (deep equality) and **skip** (`any`)
- Add examples demonstrating argument matching

**Note:** Pattern/regex matching is intentionally excluded - use `code_judge` for complex validation logic. See AGENTS.md "Design Principles" for rationale.

## Impact

- Affected specs: `evaluation`
- Affected code: `packages/core/src/evaluation/evaluators.ts` (ToolTrajectoryEvaluator)
- Non-breaking: existing configs without `args` continue to work unchanged

## Implementation Notes

### Data Source
Tool arguments are already available in `ToolCall.input` (see `packages/core/src/evaluation/providers/types.ts`).
Currently, `extractToolCallsFromMessages()` discards this - change to preserve it:
```typescript
// Current (discards args):
toolCalls.push({ name: call.tool });

// New (preserves args):
toolCalls.push({ name: call.tool, args: call.input });
```

### Type Definition
Extend `ToolTrajectoryExpectedItem` in `trace.ts`:
```typescript
interface ToolTrajectoryExpectedItem {
  tool: string;
  args?: 'any' | Record<string, unknown>;  // NEW
}
```

### Matching Semantics
- `args: any` → skip argument validation entirely
- `args: { key: value }` → partial match (only validate specified keys, use deep equality)
- If tool name matches but args don't → **full miss** (score 0 for that expected item)
- Use deep equality for nested objects
