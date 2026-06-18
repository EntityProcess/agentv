---
title: "Trust subprocess cwd for relative path resolution in CLI arg arrays"
module: copilot-sdk provider
date: 2026-06-18
problem_type: best_practice
component: tooling
severity: low
tags:
  - subprocess
  - cwd
  - relative-paths
  - cli-args
  - copilot-sdk
  - path-resolution
applies_when:
  - Spawning a subprocess that accepts CLI args including file/directory paths
  - Tempted to pre-resolve relative paths in args before passing them to a child process
  - "Using startsWith or !isAbsolute heuristics to detect path arguments in CLI arg strings"
---

# Trust subprocess cwd for relative path resolution in CLI arg arrays

## Context

When adding `args` passthrough support to the `copilot-sdk` provider target (`packages/core/src/evaluation/providers/copilot-sdk.ts`), an initial implementation attempted to pre-resolve relative paths in user-supplied CLI arg arrays before handing them to the subprocess client:

```typescript
clientOptions.cliArgs = this.config.args.map((arg) =>
  arg.startsWith('./') || arg.startsWith('../') ? path.resolve(resolvedCwd, arg) : arg,
);
```

The intent was to ensure that relative paths like `./plugins/my-plugin` would resolve from the eval workspace directory. However, the subprocess was already being given `clientOptions.cwd = resolvedCwd`, so the subprocess inherits the eval workspace as its working directory and resolves paths itself — making the pre-processing redundant and fragile.

## Guidance

When a subprocess is spawned with an explicit `cwd` set to the eval workspace, **do not pre-process user-supplied CLI arg arrays to resolve relative paths**. Set `cwd` correctly and pass args through unchanged. The subprocess resolves its own relative path arguments against its own working directory.

```typescript
// Correct: set cwd once, pass args through unchanged
const resolvedCwd = evalCwd ?? process.cwd();
clientOptions.cwd = resolvedCwd;

if (this.config.args && this.config.args.length > 0) {
  // Pass args through unchanged; the subprocess resolves relative paths against cwd above.
  clientOptions.cliArgs = [...this.config.args];
}
```

## Why This Matters

The `startsWith('./') || startsWith('../')` heuristic has three concrete failure modes:

**1. Misses bare relative paths.** A path like `plugins/foo` or `extensions/bar` does not start with `./` or `../` but is still relative and would be silently skipped, leaving it unresolved.

**2. `!path.isAbsolute()` overcorrects.** Switching to the inverse check would wrongly call `path.resolve()` on non-path arguments — flag strings like `--model=gpt-4o`, bare string values, `--config=./settings.json` passed as a single token.

**3. CLI arg arrays are heterogeneous.** A real args array mixes flags (`--verbose`), string values (`gpt-4o`), single-token flag-value pairs (`--config=./settings.json`), and positional path arguments — all interleaved. There is no safe, general heuristic to identify which elements are file paths without full knowledge of the target CLI's interface. Only the subprocess itself has that knowledge, and it applies it correctly when given the right `cwd`.

Pre-processing also violates the single-responsibility principle: `cwd` is already doing the job. Two sources of truth diverge.

## When to Apply

- Any provider target that spawns a CLI subprocess (e.g., `copilot-sdk`, any future CLI-backed provider) and accepts user-supplied `args` from eval YAML.
- Whenever you find yourself writing `arg.startsWith('./')` or `!path.isAbsolute(arg)` inside a `.map()` over a CLI arg array — stop and check whether setting `cwd` on the subprocess is sufficient instead.
- When adding passthrough `args` support to a new provider: set `cwd` first, then pass args through unchanged.

## Examples

**Before (fragile — do not use):**

```typescript
const resolvedCwd = evalCwd ?? process.cwd();
clientOptions.cwd = resolvedCwd;

if (this.config.args && this.config.args.length > 0) {
  clientOptions.cliArgs = this.config.args.map((arg) =>
    arg.startsWith('./') || arg.startsWith('../')
      ? path.resolve(resolvedCwd, arg)
      : arg,
  );
}
```

Problems: misses `plugins/foo`, fails on `--flag=./value` single-token forms, duplicates what `cwd` already accomplishes.

**After (correct):**

```typescript
const resolvedCwd = evalCwd ?? process.cwd();
clientOptions.cwd = resolvedCwd;

if (this.config.args && this.config.args.length > 0) {
  // Pass args through unchanged; subprocess resolves relative paths via cwd above.
  clientOptions.cliArgs = [...this.config.args];
}
```

**Eval YAML that works correctly with the after pattern:**

```yaml
targets:
  - id: copilot-with-plugin
    provider: copilot-sdk
    args:
      - --extensions
      - ./plugins/my-extension     # resolved by the CLI against its cwd (the eval workspace)
      - plugins/another-extension  # bare relative path — also resolved correctly by the subprocess
```

## Related

- `packages/core/src/evaluation/providers/copilot-sdk.ts` — `getOrCreateClient()` where `cwd` and `cliArgs` are set
- PR #1402 — introduced args support for the copilot-sdk provider; removed the startsWith pre-processing in a follow-up (PR #1412)
