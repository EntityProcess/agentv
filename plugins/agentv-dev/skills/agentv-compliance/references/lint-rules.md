# Governance Block Lint Rules

Rules applied when linting a `governance:` block in a `*.eval.yaml` file.
The CI Action (see `examples/governance/compliance-lint/`) passes this file to Claude
together with the governance block to extract and returns a structured report.

## How to apply these rules

For each `governance:` block found in a changed eval file:

1. Extract the block (top-level `governance:` key, or `metadata.governance` in a test case).
2. Apply each rule below in order.
3. Collect all violations.
4. Return the structured JSON report described in `SKILL.md`.

A block with zero violations produces `{ "pass": true, "violations": [] }`.

---

## Rule 1 — known_key

**What:** Every key in the `governance:` object must be in the allowed-key list.

**Allowed keys:** `schema_version`, `owasp_llm_top_10_2025`, `owasp_agentic_top_10_2025`,
`mitre_atlas`, `controls`, `risk_tier`, `owner`

**On violation:**
```json
{
  "rule": "known_key",
  "key": "<offending-key>",
  "value": "<value>",
  "message": "Unknown governance key '<offending-key>'. Did you mean '<closest-match>'?",
  "suggestion": "Replace '<offending-key>' with '<closest-match>'."
}
```

Common typos and their corrections:
- `risk_level` → `risk_tier`
- `owasp_top_10` → `owasp_llm_top_10_2025`
- `owasp_llm` → `owasp_llm_top_10_2025`
- `atlas` → `mitre_atlas`
- `mitre` → `mitre_atlas`
- `control` (singular) → `controls`

---

## Rule 2 — owasp_llm_ids

**What:** Every string in `owasp_llm_top_10_2025` must match the pattern `LLM\d{2}` (LLM01–LLM10).

**On violation:**
```json
{
  "rule": "owasp_llm_ids",
  "key": "owasp_llm_top_10_2025",
  "value": "<offending-id>",
  "message": "Invalid OWASP LLM ID '<offending-id>'. Expected LLM01–LLM10.",
  "suggestion": "Use a valid ID from references/owasp-llm-top-10-2025.md."
}
```

---

## Rule 3 — owasp_agentic_ids

**What:** Every string in `owasp_agentic_top_10_2025` must match the pattern `T\d{2}` (T01–T10).

**On violation:**
```json
{
  "rule": "owasp_agentic_ids",
  "key": "owasp_agentic_top_10_2025",
  "value": "<offending-id>",
  "message": "Invalid OWASP Agentic ID '<offending-id>'. Expected T01–T10.",
  "suggestion": "Use a valid ID from references/owasp-agentic-top-10-2025.md."
}
```

---

## Rule 4 — mitre_atlas_ids

**What:** Every string in `mitre_atlas` must match the pattern `AML\.T\d{4}(\.\d{3})?`.

**On violation:**
```json
{
  "rule": "mitre_atlas_ids",
  "key": "mitre_atlas",
  "value": "<offending-id>",
  "message": "Invalid MITRE ATLAS ID '<offending-id>'. Expected AML.Txxxx or AML.Txxxx.xxx.",
  "suggestion": "Check https://atlas.mitre.org/techniques/ for valid IDs."
}
```

---

## Rule 5 — control_id_format

**What:** Every string in `controls` must match the pattern `^[A-Z0-9][A-Z0-9_-]+-[A-Z0-9._-]+:[A-Z0-9._-]+$`
(i.e. `<FRAMEWORK>-<VERSION>:<ID>` where all three parts are present and non-empty).

Examples of valid control IDs:
- `NIST-AI-RMF-1.0:MEASURE-2.7`
- `EU-AI-ACT-2024:Art.55`
- `ISO-42001-2023:6.1.2`
- `INTERNAL-POLICY-2.1:CTRL-99`

**On violation:**
```json
{
  "rule": "control_id_format",
  "key": "controls",
  "value": "<offending-control>",
  "message": "Malformed control ID '<offending-control>'. Expected format: <FRAMEWORK>-<VERSION>:<ID>.",
  "suggestion": "Use the format <FRAMEWORK>-<VERSION>:<ID>, e.g. 'EU-AI-ACT-2024:Art.55'."
}
```

---

## Rule 6 — risk_tier_value

**What:** `risk_tier`, when present, must be one of:
`prohibited`, `high_risk`, `limited_risk`, `minimal_risk`

**On violation:**
```json
{
  "rule": "risk_tier_value",
  "key": "risk_tier",
  "value": "<offending-value>",
  "message": "Unknown risk_tier value '<offending-value>'. Allowed: prohibited, high_risk, limited_risk, minimal_risk.",
  "suggestion": "Use one of the EU AI Act risk tiers from references/eu-ai-act-risk-tiers.md."
}
```

Common mistakes:
- `high` → `high_risk`
- `limited` → `limited_risk`
- `minimal` → `minimal_risk`
- `low` → `minimal_risk` (not an EU AI Act term)

---

## Rule 7 — array_not_empty

**What:** If a framework array key is present (`owasp_llm_top_10_2025`, `owasp_agentic_top_10_2025`,
`mitre_atlas`, `controls`), it must not be an empty array.

**On violation:**
```json
{
  "rule": "array_not_empty",
  "key": "<key>",
  "value": [],
  "message": "Empty array for '<key>'. Either populate it or remove the key.",
  "suggestion": "Add at least one ID, or remove the key entirely."
}
```

---

## Severity

All rules above are **errors** (contribute to `pass: false`). There are no warnings in this
schema — an unknown key is always wrong, and empty arrays are always wrong. This matches the
intent: the block should only be present when it contains real, validated tags.
