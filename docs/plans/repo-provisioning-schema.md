# Repo Provisioning Schema Plan

Temporary implementation plan for GitHub issue #1389. Delete before merge after the user-facing docs and PR description carry the relevant details.

## Decision

Eval workspace `repos[]` declares provenance only:

```yaml
repos:
  - path: ./repo
    repo: https://github.com/org/name.git
    commit: 0123456789abcdef
    sparse: [src, tests]
    ancestor: 1
```

`repo` accepts a full URL or `org/name`, resolved to GitHub by default. `base_commit` remains an accepted alias for `commit` because it is a SWE-bench term. Legacy `source: {type: git|local}` and `checkout.resolve` are hard-deprecated and removed from parsing.

## Implementation

- Flatten `RepoConfig` in core types to `repo`, `commit`, `base_commit`, `ancestor`, and `sparse`.
- Update YAML parsing, dependency scanning, code-grader checkout hints, workspace pool fingerprints, and workspace pool metadata to use the flattened shape.
- Add canonical repo helpers so URL and `org/name` forms compare consistently.
- Add a harness-owned acquisition resolver in repo materialization:
  1. auto-adopt a registered project whose `git remote origin` matches `repo`,
  2. use an explicit `$AGENTV_HOME/config.yaml` `git_cache.mirrors` entry if present,
  3. maintain a bare mirror under `$AGENTV_DATA_DIR/git-cache/<hash(repo)>`,
  4. fall back to remote clone if cache preparation fails.
- Clone workspace repos with `--reference` when a local checkout or mirror is available. Do not default to shallow clone.
- Stream git clone progress and emit a periodic elapsed-time heartbeat by default. Convert clone timeouts to an actionable error.

## Verification

- Unit tests for flattened parsing, `base_commit` alias, `org/name` URL normalization, deps scanner output, pool fingerprinting, and local-project auto-adopt.
- CLI red/green UAT:
  - RED on `main`: a CargoWise-style large remote repo materialization starts an opaque remote clone with no default progress.
  - GREEN on this branch: with a matching registered local checkout, the same repo materializes via `git clone --reference`.
- Validate WTG.AI.Prompts templates against the worktree build and document the separate schema migration needed there.
