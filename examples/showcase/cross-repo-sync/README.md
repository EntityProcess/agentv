# Cross-Repo Sync Showcase

Evaluates whether a coding agent can keep two public repos in sync after one changes.

## Scenario

When **AgentV** (EntityProcess/agentv) ships a feature, the **agentevals** (agentevals/agentevals) spec docs must be updated to reflect the change. This eval measures how well an agent handles that cross-repo synchronization.

## Environment Features Demonstrated

| Feature | Usage |
|---------|-------|
| `environment.workdir` | AGENTS.md + skills dir available to the task environment |
| `extensions.beforeEach` | Clones agentevals at "before" state per test |
| `extensions.afterEach` | Resets git state between tests |
| `metadata` | Commit SHAs passed to setup via stdin JSON |
| `fileChanges` | Unified diff of agent's edits |

## Test Cases

1. **eval-spec-v2-sync** — Add 4 deterministic assertion types + required gates
2. **cases-to-tests-sync** — Rename `cases` → `tests` across spec docs
3. **schema-field-rename-sync** — Rename `eval_cases` → `cases`, `expected_outcome` → `criteria`/`outcome`

## Running

```bash
bun install
bun agentv eval ./evals/suite.yaml
```

## Structure

```
├── evals/
│   ├── suite.yaml          # 3 test cases
│   └── ground-truth/              # Real diffs from commit history
├── workspace-template/
│   ├── AGENTS.md                  # Multi-repo context
│   └── skills/
│       └── cross-repo-sync.md     # Sync skill
├── scripts/
│   ├── setup.ts                   # before_each: clone repo
│   ├── reset.ts                   # after_each: git reset
│   └── validate-sync.ts           # script grader
├── .agentv/
│   └── providers.yaml               # Mock CLI agent
└── package.json
```
