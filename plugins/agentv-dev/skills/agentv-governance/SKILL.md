---
name: agentv-governance
description: >-
  Author, edit, and lint `governance:` blocks in `*.eval.yaml` files.
  Use when creating or updating evaluation suites that carry AI-governance metadata
  (OWASP LLM Top 10, OWASP Agentic Top 10, MITRE ATLAS, EU AI Act, ISO 42001).
  Also use non-interactively (e.g., from a GitHub Action) to lint changed eval files
  and report violations against the rules in `references/lint-rules.md`.
  Do NOT use for running evals or benchmarking — that belongs to agentv-bench.
---

# AgentV Compliance Skill

Teaches AI agents how to author syntactically correct `governance:` blocks in AgentV
eval files, and how to lint them against known vocabulary rules.

## Dual mode

**Authoring (interactive):** When a human or AI agent is editing a `*.eval.yaml` file
that contains or should contain a `governance:` block, this skill provides vocabulary,
valid values, and example shapes. Load it alongside `agentv-eval-writer` when building
red-team or compliance suites.

**Linting (non-interactive / CI):** When invoked from a GitHub Action (see
`examples/governance/compliance-lint/`), this skill lints each changed `*.eval.yaml` file
against the rules in `references/lint-rules.md` and returns a structured JSON report.
The expected output format is:
```json
{
  "pass": true,
  "violations": [
    {
      "rule": "known_key",
      "key": "risk_level",
      "value": "high",
      "message": "Unknown governance key 'risk_level'. Did you mean 'risk_tier'?",
      "suggestion": "Replace 'risk_level' with 'risk_tier'."
    }
  ]
}
```
`pass` is `true` when `violations` is empty.

## Reference files

| File | Purpose |
|------|---------|
| `references/governance-yaml-shape.md` | YAML shape, merge semantics, worked examples |
| `references/lint-rules.md` | Machine-readable rules applied during lint |
| `references/owasp-llm-top-10-2025.md` | LLM01–LLM10 canonical IDs and descriptions |
| `references/owasp-agentic-top-10-2025.md` | T01–T10 agentic-AI categories |
| `references/mitre-atlas.md` | Common AML.Txxxx technique IDs |
| `references/eu-ai-act-risk-tiers.md` | Four risk tiers + article references |
| `references/iso-42001-controls.md` | Curated ISO/IEC 42001:2023 controls for AI eval |

## Quick authoring guide

1. Check which risks this eval exercises using the reference files above.
2. Pick IDs from the relevant frameworks (`owasp_llm_top_10_2025`, `mitre_atlas`, etc.).
3. Set `risk_tier` using EU AI Act vocabulary (`prohibited | high_risk | limited_risk | minimal_risk`).
4. Add `controls` as `<FRAMEWORK>-<VERSION>:<ID>` strings (e.g. `EU-AI-ACT-2024:Art.55`).
5. Run the lint rules from `references/lint-rules.md` against your block before committing.
6. See `references/governance-yaml-shape.md` for complete examples copied from real suites.
