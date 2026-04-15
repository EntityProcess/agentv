# Agent Skills Evals

Demonstrates evaluating Claude Code skills using both the legacy `evals.json` format and the universal `EVAL.yaml` format, including transpilation between the two.

## Files

```
agent-skills-evals/
├── README.md
├── evals.json                       # Legacy skill-creator format
├── csv-analyzer.EVAL.yaml           # Universal EVAL.yaml format
├── csv-analyzer.evals.json          # Transpiled output from EVAL.yaml
├── .agentv/
│   └── targets.yaml                 # Echo provider for dry-run testing
└── evals/
    └── files/
        └── sales.csv                # Test fixture
```

## Formats

### evals.json (legacy)

The original skill-creator format. Each eval specifies a prompt, optional files, expected output, and assertions:

```json
{
  "skill_name": "csv-analyzer",
  "evals": [
    {
      "id": 1,
      "prompt": "Find the top 3 months by revenue.",
      "files": ["evals/files/sales.csv"],
      "should_trigger": true,
      "assertions": ["Output identifies November as the highest revenue month"]
    }
  ]
}
```

### EVAL.yaml (universal)

The AgentV universal format. Richer structure with typed content blocks, multiple assertion types, and negative test cases:

```yaml
tests:
  - id: csv-top-months
    input:
      - role: user
        content:
          - type: file
            value: evals/files/sales.csv
          - type: text
            value: "Find the top 3 months by revenue."
    assertions:
      - type: skill-trigger
        skill: csv-analyzer
        should_trigger: true
      - type: rubrics
        criteria: "Output identifies November as the highest revenue month"
      - type: contains
        value: "$22,500"
```

## Transpiling EVAL.yaml to evals.json

Convert from the universal format to the legacy format:

```bash
agentv transpile csv-analyzer.EVAL.yaml
```

This produces `csv-analyzer.evals.json` — a skill-creator-compatible file that can be consumed by tools expecting the legacy format.

## Running

```bash
# Dry-run with echo provider (no LLM calls)
agentv eval csv-analyzer.EVAL.yaml

# Run against a real target
agentv eval csv-analyzer.EVAL.yaml --target default
```

## Skill setup

The `csv-analyzer` skill is included in this example under `.claude/skills/csv-analyzer/SKILL.md`. Claude Code automatically discovers skills in the project's `.claude/skills/` directory, so no global installation is needed for claude-cli, claude-sdk, or copilot targets.

## Multi-provider eval

`multi-provider-skill-trigger.EVAL.yaml` tests the same skill across multiple providers:

```bash
bun apps/cli/src/cli.ts eval multi-provider-skill-trigger.EVAL.yaml \
  --target copilot --targets ../.agentv/targets.yaml
```

The `skill-trigger` grader automatically handles each provider's tool-call format:

| Provider | Detection method |
|----------|-----------------|
| claude, claude-cli | `Skill` tool with `skill` input field |
| copilot | `Using skill: <name>` tool prefix |
| codex | `mcp:<server>/<name>` tool prefix |

## Copilot note

When running `skill-trigger` evals against Copilot targets, real traces may show provider-specific tool names such as:

```text
Using skill: <skill-name>
Viewing ...<skill-path>
```

The grader scans the entire conversation transcript (not just the first tool call), so a preamble meta-skill like `using-superpowers` firing before `csv-analyzer` still results in a pass.
