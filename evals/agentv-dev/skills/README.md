# `agentv-dev` skill evals

Three-category eval suite covering the bundled `agentv skills` CLI surface
owned by the `agentv-dev` plugin (`list`, `get`, `path`). Each category
isolates one aspect of the skill UX so a regression in any single
dimension is easy to read off the run report.

## Categories

| File | What it tests | Tests |
|------|---------------|-------|
| `skill-invocation.eval.yaml` | Does the agent invoke the right CLI command + flag for a given task? | 8 |
| `skill-selection.eval.yaml` | Does the agent pick the right skill for a natural-language task? | 8 |
| `output-correctness.eval.yaml` | Does the agent produce structurally and factually correct output (YAML, CLI commands, descriptions)? | 7 |

The three categories mirror the structure used by `agent-browser`'s
skill evals: invocation (does the agent reach for the tool), selection
(does it pick the right entry), and output (does the result hold up).

## Fixtures

`fixtures/` holds frozen snapshots of CLI output. They are checked in so
eval runs are deterministic and don't require network or build state.
Two flavours per skill:

- `agentv-<name>.txt` — bare `SKILL.md` content (`agentv skills get <name>`).
  Used in most tests; small (1.5–25 KB).
- `agentv-<name>-full.txt` — same plus any bundled support directories
  (`agentv skills get <name> --full`). Only used in tests that
  specifically validate `--full` behaviour, since these can be hundreds
  of KB.

Plus two single-purpose fixtures:

- `skills-list-all.txt` — output of `agentv skills list --json`.
- `skills-get-nonexistent.txt` — error output of `agentv skills get does-not-exist`.

### Regenerating fixtures

After any change to bundled skill content or the `agentv skills` CLI,
regenerate fixtures from the worktree root:

```bash
cd evals/agentv-dev/skills

# Bare SKILL.md per skill
for skill in agentv-bench agentv-eval-review agentv-eval-writer \
             agentv-governance agentv-trace-analyst; do
  bun ../../../apps/cli/src/cli.ts skills get "$skill" \
    > "fixtures/${skill}.txt" 2>&1
done

# --full variants (with references/, scripts/, agents/, and similar)
for skill in agentv-bench agentv-eval-review agentv-eval-writer \
             agentv-governance agentv-trace-analyst; do
  bun ../../../apps/cli/src/cli.ts skills get "$skill" --full \
    > "fixtures/${skill}-full.txt" 2>&1
done

# Listing + error fixtures
bun ../../../apps/cli/src/cli.ts skills list --json \
  > fixtures/skills-list-all.txt 2>&1
bun ../../../apps/cli/src/cli.ts skills get does-not-exist \
  > fixtures/skills-get-nonexistent.txt 2>&1
```

## Running

From the worktree root:

```bash
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

## Adding test cases

Tests are plain entries under `tests:`. Each test must have:

- `id` (kebab-case, unique within the file)
- `criteria` — one-line human description
- `input` — either a bare string or a `[{role, content: [...]}]` block
  when injecting fixtures via `type: file`
- `assertions` — at least one entry; prefer deterministic types
  (`contains`, `regex`, `icontains-any`) over `rubrics` so the eval
  stays cheap and stable. Use `rubrics` only for genuinely qualitative
  checks.

Pattern for fixture-driven tests:

```yaml
- id: my-new-test
  criteria: One-line description
  input:
    - role: user
      content:
        - type: file
          value: fixtures/agentv-eval-writer.txt
        - type: text
          value: |
            <prompt referring to the fixture>
  assertions:
    - type: contains
      value: <expected substring>
    - type: rubrics
      criteria:
        - <criterion 1>
        - <criterion 2>
```

When every test in a file shares the same fixture, declare it once at
the top level under `input:` (suite-level input, prepended to every
test) instead of repeating it per-test — see `skill-selection.eval.yaml`.
