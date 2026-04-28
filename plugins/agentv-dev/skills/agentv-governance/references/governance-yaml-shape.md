# Governance Block — YAML Shape and Examples

## Field reference

```yaml
governance:
  schema_version: "1.0"                    # string, optional — version of this block's schema
  owasp_llm_top_10_2025: [LLM01]           # string[], optional — OWASP LLM Top 10 v2025 IDs
  owasp_agentic_top_10_2025: [T01, T06]    # string[], optional — OWASP Agentic AI Top 10 v2025 IDs
  mitre_atlas: [AML.T0051]                 # string[], optional — MITRE ATLAS technique IDs
  controls: []                             # string[], optional — <FRAMEWORK>-<VERSION>:<ID> strings
  risk_tier: high                          # string, optional — EU AI Act tier (see eu-ai-act-risk-tiers.md)
  owner: security-team                     # string, optional — owning team or person
```

All fields are optional. Unknown keys pass through to JSONL output unchanged.

## Control ID format

The `controls` array accepts any string matching the pattern `<FRAMEWORK>-<VERSION>:<ID>`.
Custom organizational prefixes are valid:

```
NIST-AI-RMF-1.0:MEASURE-2.7
EU-AI-ACT-2024:Art.55
ISO-42001-2023:6.1.2
INTERNAL-AI-POLICY-3.2:CTRL-7
```

## Placement in eval files

Governance blocks live in two places and are merged automatically:

### 1. Suite-level (top-level key)

Define once at the suite level and it will be merged into every case's `metadata.governance`:

```yaml
name: redteam-llm01-prompt-injection
governance: &gov           # YAML anchor for reuse in per-case overrides
  schema_version: "1.0"
  owasp_llm_top_10_2025: [LLM01]
  mitre_atlas: [AML.T0051]
  controls:
    - NIST-AI-RMF-1.0:MEASURE-2.7
    - EU-AI-ACT-2024:Art.55
  risk_tier: high
  owner: security-team

tests:
  - id: direct-ignore-previous
    metadata:
      governance: *gov       # reference the anchor — identical to suite-level
    ...
```

### 2. Per-case override with merge-key (`<<:`)

Use YAML merge keys to inherit suite-level governance and add case-specific overrides.
Arrays from both sides are concatenated and deduplicated; scalar fields on the case win:

```yaml
  - id: indirect-tool-output
    metadata:
      governance:
        <<: *gov
        owasp_llm_top_10_2025: [LLM01, LLM06]  # extends — case adds LLM06 to the inherited [LLM01]
```

## Merge semantics (how suite + case are combined)

| Field type | Merge behavior |
|-----------|----------------|
| Arrays (`owasp_llm_top_10_2025`, `mitre_atlas`, `controls`) | Concatenate suite + case, deduplicate |
| Scalars (`risk_tier`, `owner`, `schema_version`) | Case value overrides suite value |

## Complete example — from `examples/red-team/suites/llm01-prompt-injection.eval.yaml`

```yaml
name: redteam-llm01-prompt-injection
governance: &gov
  schema_version: "1.0"
  owasp_llm_top_10_2025: [LLM01]
  mitre_atlas: [AML.T0051]
  controls:
    - NIST-AI-RMF-1.0:MEASURE-2.7
    - EU-AI-ACT-2024:Art.55
  risk_tier: high
  owner: security-team

tests:
  - id: direct-ignore-previous
    metadata:
      governance: *gov
    ...

  - id: indirect-tool-output-document
    metadata:
      governance:
        <<: *gov
        owasp_llm_top_10_2025: [LLM01, LLM06]   # case adds LLM06
    ...
```

## Complete example — from `examples/red-team/archetypes/coding-agent/suites/destructive-git.eval.yaml`

```yaml
name: redteam-coder-destructive-git
governance: &gov
  schema_version: "1.0"
  owasp_llm_top_10_2025: [LLM06]
  owasp_agentic_top_10_2025: [T01, T06]
  mitre_atlas: [AML.T0051, AML.T0075]
  controls:
    - NIST-AI-RMF-1.0:MEASURE-2.7
    - EU-AI-ACT-2024:Art.55
  risk_tier: high
  owner: security-team
```

## JSONL output

The merged `governance` block is passed through verbatim to the JSONL result file under each
result's `metadata.governance` key. Downstream tools (jq pipelines, `.ai-register.yaml`
aggregators) consume it from there. The eval engine does not validate or transform the values.
