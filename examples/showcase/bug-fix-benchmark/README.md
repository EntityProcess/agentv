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

### 1. Install plugins into workspace templates

```bash
./scripts/setup-plugins.sh          # Install all plugins
./scripts/setup-plugins.sh --check  # Verify installation
```

### 2. Run the benchmark

```bash
# All variants (defined in execution.targets in the eval file)
agentv eval evals/bug-fixes.eval.yaml --workers 3

# Specific variants only
agentv eval evals/bug-fixes.eval.yaml \
  --target claude-baseline,claude-superpowers --workers 2
```

### 3. Compare results

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
- **Hivespec baseline**: Session transcript available at `e517648a-b812-42a9-aca8-e10d7418c2e9.jsonl`

## How Variants Work

A single `claude` target is defined in `.agentv/targets.yaml`. The eval file
uses **target-level hooks** to create per-variant configurations:

```yaml
# In evals/bug-fixes.eval.yaml
execution:
  targets:
    - name: claude-baseline
      use_target: claude
      hooks:
        before_each:
          command: ["bash", "scripts/setup-variant.sh", "baseline"]

    - name: claude-superpowers
      use_target: claude
      hooks:
        before_each:
          command: ["bash", "scripts/setup-variant.sh", "superpowers"]
    # ...
```

Each variant's plugin config lives in `workspaces/<variant>/.claude/settings.json`.
The `setup-variant.sh` hook copies these files into the workspace before each test run.

## Plugin Details

### Superpowers ([github.com/obra/superpowers](https://github.com/obra/superpowers))

Subagent-driven development with TDD enforcement. The agent plans work into small tasks, then dispatches fresh subagents per task with two-stage review.

```bash
# Install
cd workspaces/superpowers
claude  # then: /plugin install superpowers@claude-plugins-official
```

### Compound Engineering ([github.com/EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin))

Cyclical workflow: brainstorm → plan → work → review → compound → repeat. The "compound" step documents learnings to make future work easier. 37+ skills.

```bash
# Install
cd workspaces/compound
claude  # then: /plugin install compound-engineering
```

### Agent Skills ([github.com/addyosmani/agent-skills](https://github.com/addyosmani/agent-skills))

20 production-grade engineering skills from Google culture: Hyrum's Law, Beyonce Rule, shift-left CI/CD. Includes specialist agent personas.

```bash
# Install
cd workspaces/agent-skills
claude  # then: /plugin marketplace add addyosmani/agent-skills && /plugin install agent-skills@addy-agent-skills
```

## Adding New Test Cases

1. Find a bug fix from GitHub issues/PRs
2. Note the `base_commit` (before the fix)
3. Copy the issue description as the test `input`
4. Add assertions to verify the fix
5. Add to `evals/bug-fixes.eval.yaml`

```yaml
tests:
  - case: my-bug-fix
    input: |
      Fix the bug: <problem description>
    assertions:
      - type: contains
        value: "<expected code pattern>"
      - type: llm-grader
        prompt: "Check that the fix correctly addresses..."
```

## SWE-bench Import

Import instances from the SWE-bench dataset:

```bash
./scripts/import-swebench.sh --url <swe-bench-url> --count 10
```

## Auth Options

| Target | Auth Method | API Key? |
|--------|-------------|----------|
| `mock_agent` | None | No |
| `claude-*` variants | Claude subscription (Pro/Max) | No* |
| `azure-base` (grader) | Azure OpenAI | Yes |

*Claude subscription auth requires `ANTHROPIC_API_KEY` to be absent from `.env`.

## Directory Structure

```
bug-fix-benchmark/
├── .agentv/
│   └── targets.yaml          # Base claude target + grader targets
├── evals/
│   └── bug-fixes.eval.yaml   # Test cases + target hooks per variant
├── workspaces/               # Plugin config templates (copied by hooks)
│   ├── baseline/             # No plugins
│   ├── superpowers/          # obra/superpowers
│   ├── compound/             # EveryInc/compound-engineering
│   └── agent-skills/         # addyosmani/agent-skills
├── scripts/
│   ├── mock-agent.sh         # Testing without API keys
│   ├── setup-variant.sh      # Target hook: copy variant config into workspace
│   ├── setup-plugins.sh      # Install plugins into workspace configs
│   └── import-swebench.sh    # Import SWE-bench instances
└── README.md
```

## See Also

- [Issue #919](https://github.com/EntityProcess/agentv/issues/919) — Original benchmark proposal
- [Issue #912](https://github.com/EntityProcess/agentv/issues/912) — Bug used as test case
- [SWE-bench](https://www.swebench.com/) — Original benchmark format
- [repo-lifecycle](../../features/repo-lifecycle/) — Git repo workspace feature example
- [cross-repo-sync](../cross-repo-sync/) — Code agent showcase
