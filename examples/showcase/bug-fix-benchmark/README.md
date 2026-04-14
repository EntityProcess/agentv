# Bug Fix Benchmark

**SWE-bench style evaluation**: Real-world bug fixing on public GitHub repositories, comparing baseline agents against plugin-augmented workflows.

This showcase answers the question: **Do engineering plugins actually help agents fix bugs better?**

## What It Tests

Compares four configurations on identical bug fix tasks:

| Target | Plugin | Philosophy |
|--------|--------|------------|
| `claude-baseline` | None | Raw agent capability |
| `claude-superpowers` | [obra/superpowers](https://github.com/obra/superpowers) | Subagent-driven TDD |
| `claude-compound` | [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | Compound learning cycles |
| `claude-agent-skills` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | Google-style engineering gates |

**Metrics**: tokens consumed, time to complete, fix correctness.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Clone public repo at base_commit (broken state)              │
│ 2. Run target before_each hook (install plugin config)           │
│ 3. Agent receives issue description                              │
│ 4. Agent diagnoses and writes fix                                │
│ 5. Grade: Does the fix work?                                     │
│                                                                  │
│ Repeat for each plugin variant, compare results.                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Run the benchmark

```bash
# All variants (defined in execution.targets in the eval file)
agentv eval evals/bug-fixes.eval.yaml --workers 3

# Specific variants only
agentv eval evals/bug-fixes.eval.yaml \
  --target claude-baseline,claude-superpowers --workers 2
```

### 2. Compare results

```bash
agentv compare \
  .agentv/results/runs/<baseline-timestamp>/index.jsonl \
  .agentv/results/runs/<superpowers-timestamp>/index.jsonl
```

## Test Case: Issue #912

The eval includes a real bug from the agentv repo:

- **Issue**: [#912 — CLI provider retries don't preserve workspace cwd](https://github.com/EntityProcess/agentv/issues/912)
- **Base commit**: `6e446b72` (before the fix)
- **Fix location**: `packages/core/src/evaluation/providers/cli.ts`
- **Pattern**: Missing null-coalescing fallback (`request.cwd ?? this.config.cwd`)

## How Variants Work

The `claude` target from the repo root `.agentv/targets.yaml` is used as the
base. The eval file uses **target-level hooks** to create per-variant configurations:

```yaml
# In evals/bug-fixes.eval.yaml
execution:
  targets:
    - name: claude-baseline
      use_target: claude
      hooks:
        before_each:
          command: ["bash", "../scripts/setup-variant.sh", "baseline"]

    - name: claude-superpowers
      use_target: claude
      hooks:
        before_each:
          command: ["bash", "../scripts/setup-variant.sh", "superpowers"]
    # ...
```

Each variant's plugin config lives in `workspaces/<variant>/.claude/settings.json`.
The `setup-variant.sh` hook copies these files into the workspace before each test run.

## Adding New Test Cases

1. Find a bug fix from GitHub issues/PRs
2. Note the `base_commit` (before the fix)
3. Copy the issue description as the test `input`
4. Add assertions to verify the fix
5. Add to `evals/bug-fixes.eval.yaml`

```yaml
tests:
  - id: my-bug-fix
    input: |
      Fix the bug: <problem description>
    assertions:
      - type: contains
        value: "<expected code pattern>"
      - "The fix correctly addresses the root cause"
```

## Directory Structure

```
bug-fix-benchmark/
├── evals/
│   └── bug-fixes.eval.yaml   # Test cases + target hooks per variant
├── workspaces/               # Plugin config templates (copied by hooks)
│   ├── baseline/             # No plugins
│   ├── superpowers/          # obra/superpowers
│   ├── compound/             # EveryInc/compound-engineering
│   └── agent-skills/         # addyosmani/agent-skills
├── scripts/
│   └── setup-variant.sh      # Target hook: copy variant config into workspace
└── README.md
```

## See Also

- [Issue #919](https://github.com/EntityProcess/agentv/issues/919) — Original benchmark proposal
- [Issue #912](https://github.com/EntityProcess/agentv/issues/912) — Bug used as test case
- [repo-lifecycle](../../features/repo-lifecycle/) — Git repo workspace feature example
- [cross-repo-sync](../cross-repo-sync/) — Code agent showcase
