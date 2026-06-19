# `agentv-dev` skill evals

Three-category eval suite covering the bundled `agentv skills` CLI surface
owned by the `agentv-dev` plugin (`list`, `get`, `path`). Each category
isolates one aspect of the skill UX so a regression in any single
dimension is easy to read off the run report.

## Coverage Model

These evals intentionally avoid checked-in transcript fixtures. They read the
live repo content directly:

- `plugins/agentv-dev/skills/agentv-dev/SKILL.md` for the plugin-aligned skill
  catalog and command surface
- `skills-data/*/SKILL.md` for the actual bundled skill bodies shipped by the
  CLI
- `apps/web/src/content/docs/docs/getting-started/installation.mdx` for the
  live CLI usage examples

That keeps the suite aligned with the current repo instead of stale snapshots.

## Categories

| File | What it tests | Tests |
|------|---------------|-------|
| `skill-invocation.eval.yaml` | Does the agent invoke the right CLI command + flag for a given task? | 8 |
| `skill-selection.eval.yaml` | Does the agent pick the right skill for a natural-language task? | 8 |
| `output-correctness.eval.yaml` | Does the agent produce structurally and factually correct output from live skill/docs content? | 7 |

## Running

From the worktree root:

```bash
# Validate the suite
bun apps/cli/src/cli.ts validate evals/agentv-dev/skills

# All three categories against one target
bun apps/cli/src/cli.ts eval run evals/agentv-dev/skills/*.eval.yaml --target <target>

# A single category
bun apps/cli/src/cli.ts eval run \
  evals/agentv-dev/skills/skill-selection.eval.yaml --target azure

# A single test
bun apps/cli/src/cli.ts eval run \
  evals/agentv-dev/skills/skill-invocation.eval.yaml \
  --test-id invoke-get-full-flag --target azure
```

`<target>` is any name resolvable from `.agentv/targets.yaml` in the worktree
(for example `azure`, `claude`, or `codex`).

## Adding Test Cases

Tests are plain entries under `tests:`. Each test must have:

- `id` (kebab-case, unique within the file)
- `criteria` — one-line human description
- `input` — either a bare string or a `[{role, content: [...]}]` block
- `assertions` — at least one entry; prefer deterministic types
  (`contains`, `regex`, `icontains-any`) over `rubrics` so the eval
  stays cheap and stable. Use `rubrics` only for genuinely qualitative
  checks.

Pattern for repo-driven file tests:

```yaml
- id: my-new-test
  criteria: One-line description
  input:
    - role: user
      content:
        - type: file
          value: /skills-data/agentv-eval-writer/SKILL.md
        - type: text
          value: |
            <prompt referring to the live repo file>
  assertions:
    - type: contains
      value: <expected substring>
    - type: rubrics
      criteria:
        - <criterion 1>
        - <criterion 2>
```

When multiple tests share the same live file, declare it once at the top level
under `input:` (suite-level input, prepended to every test) instead of
repeating it per-test — see `skill-selection.eval.yaml`.
