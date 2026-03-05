# Workspace Repo Lifecycle Design

**Issue:** #410 — First-class workspace repo lifecycle (HTTPS clone, ref pinning, reset strategies)
**Date:** 2026-03-05

## Overview

Add declarative repo lifecycle support to `workspace` in eval.yaml so users don't need custom `before_all`/`after_each` scripts for clone/checkout/reset workflows.

## Schema

New optional fields on `workspace`:

```yaml
workspace:
  template: ./fixtures              # existing (unchanged)
  isolation: shared                 # NEW: shared (default) | per_test
  repos:                            # NEW
    - path: ./repo-a
      source:
        type: git
        url: https://github.com/org/repo-a.git
      checkout:
        ref: main                   # branch | tag | SHA
        resolve: remote             # remote (default) | local
        ancestor: 0                 # 0=self (default), 1=parent, etc.
      clone:
        depth: 2                    # shallow clone
        filter: blob:none           # partial clone
        sparse:
          - src/**
          - package.json
    - path: ./repo-b
      source:
        type: local
        path: /opt/mirrors/repo-b
      checkout:
        ref: 4a1b2c3d
  reset:                            # NEW
    strategy: hard                  # none (default) | hard | recreate
    after_each: true                # apply reset between tests
  before_all: ...                   # existing (unchanged)
  after_each: ...                   # existing (unchanged)
```

Key rules:
- `repos` is optional. Without it, existing behavior is unchanged.
- `source.type: git` clones from URL (HTTPS, `GIT_TERMINAL_PROMPT=0`).
- `source.type: local` uses local path as clone source.
- `checkout.resolve: remote` resolves symbolic refs via `git ls-remote` before clone.
- `checkout.resolve: local` resolves refs after clone from cache.
- `checkout.ancestor: N` walks N parents from resolved ref. Requires sufficient depth.
- `reset.strategy: hard` = `git reset --hard <checkout-ref> && git clean -fd` per repo.
- `reset.strategy: recreate` = re-materialize workspace from scratch.
- `reset.after_each: true` applies reset between tests (shared isolation only).
- Path collisions between `template` content and `repos[].path` rejected at validation.

## Persistent Git Cache

```
~/.agentv/git-cache/
├── {url-hash}/          # bare mirror per unique repo URL (SHA-256 of normalized URL)
```

- First encounter: `git clone --mirror --bare <url>` into cache.
- Subsequent runs: `git fetch --prune` to update.
- Cache key: SHA-256 of normalized URL (lowercased, `.git` suffix stripped).
- Lock-protected: `{url-hash}.lock` prevents concurrent fetches. Wait up to 60s, then fail.
- `source.type: local` repos also cached as bare mirrors.
- Cache is read-only from workspace perspective.

Workspace materialization from cache:
- `git clone --reference <cache-dir> <url> <workspace-path>` for object reuse.
- Shallow clones: `git clone --depth N --reference <cache-dir> <url> <workspace-path>`.
- After clone: `git checkout <resolved-ref>`, walk ancestors if `ancestor > 0`.

Cache GC deferred to follow-up issue.

## Materialization Flow

Order within orchestrator:

```
1. Copy workspace.template (existing, unchanged)
2. Materialize repos (NEW)
   a. For each repo in workspace.repos:
      - Ensure cache exists (clone --mirror) or update (fetch)
      - Clone from cache into workspace at repos[].path
      - Checkout resolved ref
      - Walk ancestors if ancestor > 0
3. Execute before_all hook (existing, unchanged)
4. Initialize git baseline (existing, unchanged)
5. Run tests...
```

Ref resolution:
- `resolve: remote`: `git ls-remote <url> <ref>` to get SHA. Fail fast if unreachable.
- `resolve: local`: resolve from cache after fetch.
- `ancestor > 0`: `git rev-parse HEAD~N`, auto-deepen if insufficient depth.

Reset between tests (shared workspace):
- `hard` + `after_each`: per repo `git reset --hard <checkout-ref> && git clean -fd`. Runs before `after_each` hook.
- `recreate` + `after_each`: delete workspace, re-run steps 1-2.
- `none` (default): no automatic reset.

Per-test isolation (`isolation: per_test`):
- Each test gets own workspace. Repos materialized fresh per test (using cache). No reset needed.

Error handling:
- `GIT_TERMINAL_PROMPT=0` on all git commands.
- Hard timeout 300s on clone/fetch (configurable).
- Preflight `git ls-remote` for `resolve: remote` — fail fast with actionable error.
- Ancestor walk failure: error suggesting increasing `clone.depth`.

## Module Structure

New files in `packages/core/src/evaluation/workspace/`:

```
workspace/
├── manager.ts              # existing (unchanged)
├── resolve.ts              # existing (unchanged)
├── script-executor.ts      # existing (unchanged)
├── file-changes.ts         # existing (unchanged)
├── repo-manager.ts         # NEW
└── repo-manager.test.ts    # NEW
```

`RepoManager` public API:

```typescript
class RepoManager {
  constructor(cacheDir?: string)  // defaults to ~/.agentv/git-cache

  ensureCache(source: RepoSource): Promise<string>
  materialize(repo: RepoConfig, workspacePath: string): Promise<void>
  materializeAll(repos: RepoConfig[], workspacePath: string): Promise<void>
  reset(repos: RepoConfig[], workspacePath: string, strategy: 'hard' | 'recreate'): Promise<void>
  cleanCache(): Promise<void>
}
```

## Schema Additions

In `eval-file.schema.ts`:

```typescript
const RepoSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('git'), url: z.string().url() }),
  z.object({ type: z.literal('local'), path: z.string() }),
])

const RepoCheckoutSchema = z.object({
  ref: z.string().optional(),
  resolve: z.enum(['remote', 'local']).default('remote'),
  ancestor: z.number().int().min(0).default(0),
})

const RepoCloneSchema = z.object({
  depth: z.number().int().min(1).optional(),
  filter: z.string().optional(),
  sparse: z.array(z.string()).optional(),
})

const RepoSchema = z.object({
  path: z.string(),
  source: RepoSourceSchema,
  checkout: RepoCheckoutSchema.optional(),
  clone: RepoCloneSchema.optional(),
})

const ResetSchema = z.object({
  strategy: z.enum(['none', 'hard', 'recreate']).default('none'),
  after_each: z.boolean().default(false),
})
```

Types added to `types.ts` to match.

## Validation Rules

`agentv validate` gains:

1. Path collision: `template` content vs `repos[].path` — reject with error.
2. Depth vs ancestor: warn if `clone.depth < ancestor + 1`.
3. Reset without repos: `reset.strategy: hard` requires repos — warn.
4. Reset + per_test: `reset.after_each` with `isolation: per_test` is redundant — warn.

## CLI Changes

- `agentv cache clean` — deletes `~/.agentv/git-cache/`. Confirmation prompt unless `--force`.
- `agentv validate` — validates new schema fields (Zod + custom rules).

## Remove Default System Prompts

Remove `DEFAULT_SYSTEM_PROMPT` ("Do NOT create any additional output files") from all 7 providers:
- `claude.ts`
- `codex.ts`
- `codex-cli.ts`
- `copilot-cli.ts`
- `copilot-sdk.ts`
- `pi-coding-agent.ts`
- `vscode-templates.ts`

Rationale: if there's a workspace, agents should modify files freely (file_changes captures diffs). If there's no workspace, there are no files to evaluate. The prompt is always either unnecessary or counterproductive. Users can still set custom system prompts via target config.

## Backward Compatibility

- Existing `workspace_template` and lifecycle hooks unchanged.
- New fields are all optional and additive.
- Hooks remain available as escape hatches for specialized setup.
