# AgentV Beads Worktree Recovery

AgentV uses two different repositories:

- Public code: `EntityProcess/agentv`
- Private coordination Beads data: `EntityProcess/agentv-beads`

Do not point Beads or Dolt data at the public code repo. The committed
`.beads/config.yaml` is the repo-owned pointer to the Beads federation remote.
`.beads/metadata.json`, embedded Dolt data, locks, JSONL exports, and other
runtime files are checkout-local and must not be copied between worktrees or
committed.

## Preflight

Run this before `bd bootstrap`, `bd dolt push`, or `bd federation sync` in a
new checkout or worktree:

```bash
bun scripts/check-beads-context.ts
```

For a file-only check that cannot open `bd`:

```bash
bun scripts/check-beads-context.ts --skip-bd
```

For a deeper local diagnostic that asks `bd` to inspect federation status and
Dolt remotes in readonly mode:

```bash
bun scripts/check-beads-context.ts --deep
```

A healthy setup has:

```bash
git remote get-url origin
# https://github.com/EntityProcess/agentv.git

rg '^federation\.remote:' .beads/config.yaml
# federation.remote: "git+https://github.com/EntityProcess/agentv-beads.git"

bd --readonly context --json
bd --readonly bootstrap --dry-run --json
```

`bd bootstrap --dry-run` must not report a `sync_remote` under
`EntityProcess/agentv.git`. If it does, stop before pushing or bootstrapping
and recover the Dolt remote first.

## Fresh Worktree Rule

Do not copy `.beads/metadata.json` or `.beads/embeddeddolt/` from another
checkout into a worktree. Let `bd bootstrap` create checkout-local identity
state after the Beads remote has been verified.

For a newly created AgentV worktree:

```bash
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
bun scripts/check-beads-context.ts
bd bootstrap --dry-run
bd bootstrap
```

If the preflight reports that `bd bootstrap` would sync from
`EntityProcess/agentv.git`, do not run `bd bootstrap` yet.

## Re-point A Wrong Dolt Remote

Use these commands when `bd dolt remote list`, `bd bootstrap --dry-run`, or
`bd federation status` shows Beads data pointed at the public code repo:

```bash
bd dolt remote list
bd dolt remote remove origin
bd dolt remote add origin git+https://github.com/EntityProcess/agentv-beads.git
bd bootstrap --dry-run
bd bootstrap
bd federation status
```

If `bd federation status` reports a project identity or `project_id` mismatch,
remove copied checkout-local metadata before re-running bootstrap:

```bash
rm -f .beads/metadata.json
bd bootstrap --dry-run
bd bootstrap
bd federation status
```

Do not delete `.beads/embeddeddolt/`, `.beads/dolt/`, or backups as a first
step. Those may contain local tracker data. If re-pointing plus bootstrap does
not clear the mismatch, stop and hand the checkout to the coordinator with the
preflight output.
