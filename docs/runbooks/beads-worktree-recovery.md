# AgentV Beads Worktree Recovery

AgentV keeps code and tracker data in separate repositories:

- Code repository: `EntityProcess/agentv`
- Beads coordination repository: `EntityProcess/agentv-beads`

Do not point Beads, Dolt, bootstrap, or federation data at the code repository.
The tracked `.beads/metadata.json` preserves AgentV's embedded Dolt identity:
database `av` and project `a7aea826-0087-45fc-93f5-9084e9924e8b`.

`.beads/config.yaml` is checkout-local. Copy `.beads/config.yaml.example`
before running `bd bootstrap`; the example pins both `sync.remote` and
`federation.remote` to `EntityProcess/agentv-beads`.

Beads supports Git worktrees natively. AgentV worktrees should normally use
plain `bd` commands and share the primary checkout's hydrated Beads database.
Do not bootstrap a second worktree-local embedded Dolt database when the
primary checkout already has `.beads/embeddeddolt`.

## Preflight

Run the guard before `bd bootstrap`, `bd dolt push`, or `bd federation sync`:

```bash
bun run beads:check
```

For static repository checks only:

```bash
bun run beads:check -- --skip-bd
```

For a disposable fresh-bootstrap fixture:

```bash
bun run beads:check -- --fixture
```

A healthy setup reports database `av`, project
`a7aea826-0087-45fc-93f5-9084e9924e8b`, and bootstrap `sync_remote`
`git+https://github.com/EntityProcess/agentv-beads.git`.

## Fresh Worktree

After creating an AgentV worktree:

```bash
bun install
cp "$(git worktree list --porcelain | head -1 | sed 's/worktree //')/.env" .env
bun run beads:check
bd worktree info
bd where
```

`bd where` should report the primary checkout's `.beads` path. If it reports
the worktree's own `.beads/embeddeddolt`, do not run `bd bootstrap` or
`bd dolt pull` against that local database. Prefer creating future worktrees
with `bd worktree create`; for an existing manually-created worktree, add a
checkout-local redirect:

```bash
primary="$(git worktree list --porcelain | head -1 | sed 's/worktree //')"
realpath --relative-to=. "$primary/.beads" > .beads/redirect
bd where
```

If the primary checkout does not have a hydrated Beads database yet, copy
`.beads/config.yaml.example` to `.beads/config.yaml` in the primary checkout,
run `bun run beads:check`, then use `bd bootstrap --dry-run` and `bd bootstrap`.
Stop if the dry run plans to sync from
`git+https://github.com/EntityProcess/agentv.git` or database `beads`.

## Recovery

If `bd --readonly context --json` reports database `beads`, no project ID, or a
project ID other than `a7aea826-0087-45fc-93f5-9084e9924e8b`, restore the tracked
identity first:

```bash
git restore -- .beads/metadata.json
```

If this is a linked worktree and `bd where` points at the worktree's own
`.beads/embeddeddolt`, redirect it to the primary checkout:

```bash
primary="$(git worktree list --porcelain | head -1 | sed 's/worktree //')"
realpath --relative-to=. "$primary/.beads" > .beads/redirect
bun run beads:check
```

If this is the primary checkout rather than a linked worktree, use local config:

```bash
cp .beads/config.yaml.example .beads/config.yaml
bun run beads:check
```

If the Dolt origin or bootstrap plan still points at the code repository,
re-point the Dolt remote before pushing:

```bash
bd dolt remote list
bd dolt remote remove origin
bd dolt remote add origin git+https://github.com/EntityProcess/agentv-beads.git
bd bootstrap --dry-run
bd bootstrap
bd federation status
```

Do not delete `.beads/embeddeddolt/`, `.beads/dolt/`, or backups as the first
recovery step. They may contain local coordination data. If the guard still
reports a metadata or project mismatch after restoring metadata and re-pointing
the remote, preserve the checkout and hand the guard output to the coordinator.
