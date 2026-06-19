# AgentV Plugin-Aligned Self Evals

This directory holds the repo-owned self-evaluation suites, split to match the
current plugin boundary:

- `agentv-self` covers AgentV's own repo guidance and self-eval workspace
  behavior.
- `agentv-dev` covers the bundled `agentv skills` CLI surface and skill content
  shipped with the developer plugin.

## Structure

```text
evals/
├── agentv-self/
│   ├── agentv-self.eval.yaml
│   ├── azure-smoke.eval.yaml
│   └── scripts/setup.mjs
├── agentv-dev/
│   └── skills/
│       ├── *.eval.yaml
│       ├── fixtures/
│       └── README.md
└── agentic-engineering/
```

## Running

Use the local CLI source from the repo root:

```bash
# Validate the renamed suites
bun apps/cli/src/cli.ts validate evals/agentv-self/agentv-self.eval.yaml
bun apps/cli/src/cli.ts validate evals/agentv-self/azure-smoke.eval.yaml
bun apps/cli/src/cli.ts validate evals/agentv-dev/skills/*.eval.yaml

# Prepare one agentv-self case and inspect the materialized workspace
bun apps/cli/src/cli.ts prepare \
  evals/agentv-self/agentv-self.eval.yaml \
  --test-id guidance-split-paths \
  --target codex

# Run the agentv-dev skills suite against a target
bun apps/cli/src/cli.ts eval run evals/agentv-dev/skills/*.eval.yaml --target <target>
```

`agentv-self/agentv-self.eval.yaml` uses a `before_all` hook to copy the current repo
checkout into the eval workspace. That keeps `/AGENTS.md` and `/.agents/`
current without declaring extra repos in workspace config.
