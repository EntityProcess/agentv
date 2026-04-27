# Governance Compliance Lint Action

A reference GitHub Action that lints `governance:` blocks in changed `*.eval.yaml` files
using the `agentv-compliance` skill. The same skill that powers AI authoring also powers
CI enforcement — no separate runtime package needed.

## How it works

1. On every PR touching `*.eval.yaml` files, the Action extracts `governance:` blocks from
   each changed file (suite-level and per-case).
2. Each block is passed to Claude with the `agentv-compliance` skill loaded.
3. Claude applies the rules in `plugins/agentv-dev/skills/agentv-compliance/references/lint-rules.md`
   and returns a structured JSON report (`{ pass: bool, violations: [...] }`).
4. The Action posts a summary as a PR comment and exits non-zero on any `pass: false` result.

## Adoption (5 minutes)

### 1. Copy the workflow

```bash
cp examples/governance/compliance-lint/compliance-lint.yml .github/workflows/compliance-lint.yml
```

### 2. Set the `ANTHROPIC_API_KEY` secret

In your repository: **Settings → Secrets and variables → Actions → New repository secret**
Name: `ANTHROPIC_API_KEY`, value: your key from console.anthropic.com.

### 3. Point at your skill location (optional)

By default the workflow looks for the skill at
`plugins/agentv-dev/skills/agentv-compliance/` relative to the repo root.
If your skill lives elsewhere, set `SKILL_PATH` in the workflow env:

```yaml
env:
  SKILL_PATH: path/to/your/agentv-compliance
```

### 4. Push a PR with a `*.eval.yaml` change

The Action runs automatically and posts a comment like:

```
## Governance Compliance Lint

**examples/red-team/suites/my-suite.eval.yaml** ✅
  - `governance`: ✅ pass

✅ All governance blocks passed.
```

Or for violations:

```
## Governance Compliance Lint

**examples/red-team/suites/my-suite.eval.yaml** ❌
  - `governance`: ❌ 2 violation(s)
    - **risk_tier_value** `risk_tier`: Unknown risk_tier value 'critical'.
      *Suggestion:* Use one of: prohibited, high_risk, limited_risk, minimal_risk.
    - **owasp_llm_ids** `owasp_llm_top_10_2025`: Invalid OWASP LLM ID 'LLM99'.
      *Suggestion:* Use a valid ID from references/owasp-llm-top-10-2025.md.
```

## Cost

Using `claude-haiku-4-5`, a 10-file PR with one governance block each costs approximately:
- ~500 tokens input per block (skill context + block YAML + instructions)
- ~200 tokens output (JSON report)
- ~$0.003 per block → **~$0.03 for 10 blocks** — well under the 5 cent target.

The skill context is sent once per block. For large PRs, batch or cache the skill text
in-process (already done by `lint.py` — it loads the skill once and reuses it).

## Making lint mandatory

This Action is **opt-in** by default. To make it mandatory:

1. In **Settings → Branches → Branch protection rules** for `main`, add
   `compliance-lint` as a required status check.
2. Violations then block merge until the author fixes the governance block.

## Customising the rules

Edit `plugins/agentv-dev/skills/agentv-compliance/references/lint-rules.md` to add, remove,
or adjust rules. The Action picks up changes automatically on the next run — no code change needed.

## Files

```
examples/governance/compliance-lint/
├── compliance-lint.yml   # GitHub Actions workflow (copy to .github/workflows/)
├── script/
│   └── lint.py           # Python script: extracts blocks, calls Claude, posts comment
└── README.md             # This file
```

The skill lives at:
```
plugins/agentv-dev/skills/agentv-compliance/
├── SKILL.md
└── references/
    ├── governance-yaml-shape.md
    ├── lint-rules.md           ← rules applied by lint.py
    ├── owasp-llm-top-10-2025.md
    ├── owasp-agentic-top-10-2025.md
    ├── mitre-atlas.md
    ├── eu-ai-act-risk-tiers.md
    └── iso-42001-controls.md
```
