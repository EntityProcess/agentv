# AgentV Plugin-Aligned Self Evals

This directory holds the repo-owned self-evaluation suites, split to match the
current plugin boundary:

- `agentv-self` covers AgentV's own repo guidance and self-eval workspace
  behavior.
- `agentv-dev` covers the bundled `agentv skills` CLI surface and skill content
  shipped with the developer plugin. It reads live repo files from
  `plugins/agentv-dev/`, `skills-data/`, and current docs instead of
  checked-in transcript fixtures.

## Structure

```text
evals/
├── agentv-self/
│   ├── agentv-self.eval.yaml
│   ├── azure-smoke.eval.yaml
│   ├── pr-workflow-guard.eval.yaml
│   ├── graders/
│   │   ├── pr-workflow-coordination.ts
│   │   └── required-file-reads.ts
│   └── scripts/setup.mjs
├── agentv-dev/
│   └── skills/
│       ├── *.eval.yaml
│       └── README.md
└── agentic-engineering/
```

## Running

Use the local CLI source from the repo root:

```bash
# Validate the renamed suites
bun apps/cli/src/cli.ts validate evals/agentv-self/agentv-self.eval.yaml
bun apps/cli/src/cli.ts validate evals/agentv-self/azure-smoke.eval.yaml
bun apps/cli/src/cli.ts validate evals/agentv-self/pr-workflow-guard.eval.yaml
bun apps/cli/src/cli.ts validate evals/agentv-dev/skills/*.eval.yaml

# Prepare one agentv-self case and inspect the materialized workspace
bun apps/cli/src/cli.ts prepare \
  evals/agentv-self/agentv-self.eval.yaml \
  --test-id guidance-split-paths \
  --target codex

# Prepare the PR-only workflow guard without invoking a live agent
bun apps/cli/src/cli.ts prepare \
  evals/agentv-self/pr-workflow-guard.eval.yaml \
  --test-id pr-only-merge-coordination \
  --target codex

# Run the agentv-dev skills suite against a target
bun apps/cli/src/cli.ts eval run evals/agentv-dev/skills/*.eval.yaml --target <target>
```

`agentv-self/agentv-self.eval.yaml` uses a `before_all` hook to copy the current repo
checkout into the eval workspace. That keeps `/AGENTS.md` and `/.agents/`
current without declaring extra repos in workspace config.

`agentv-self/pr-workflow-guard.eval.yaml` is intentionally a one-case,
low-cost coordination eval. Its setup hook materializes AgentV from the
pre-guardrail fixture commit `9acb149b`, overlays current `AGENTS.md` and
`.agents/` from `origin/main`, and writes fake local `gh`, `git`, and `workmux`
fixtures under the prepared workspace. The prompt asks for a decision plan and
forbids live public-repo side effects; the deterministic grader fails local
`git merge`, push or force-push to `main`, draft PR merges, and live side-effect
tool calls.
