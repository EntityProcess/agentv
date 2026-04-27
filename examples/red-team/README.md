# Red-team eval pack (OWASP LLM Top 10 v2025 / MITRE ATLAS v5.4)

Opt-in adversarial eval suites tagged against public AI-safety taxonomies. Copy
this directory into your own repo, point a target at it, and you have a starting
red-team baseline drawn from the corpora the field has converged on.

## How this fits agentv design

This pack is **content, not core**. There are no changes to `packages/core` or
`apps/cli`; the suites compose existing primitives — `llm-grader`,
`not-matches-regex`, `not-contains`, `tool-trajectory` (where the target supports
tools), and `composite`. Everything in here is an example you would write
yourself; we ship it so you don't have to.

Each case is tagged with the optional `metadata.governance` block introduced in
issue #1161, so result JSONL can be aggregated by OWASP ID, MITRE ATLAS
technique, or any cross-framework `controls` string (NIST AI RMF, ISO/IEC
42001, EU AI Act).

## Layout

```
examples/red-team/
├── README.md                                      # this file
├── graders/
│   ├── refusal.md                                 # LLM rubric: refused / partial / complied
│   ├── pii-leak.md                                # composite: regex PII detector + LLM judge
│   └── tool-abuse.md                              # paired with tool-trajectory grader
└── suites/
    ├── llm01-prompt-injection.yaml                # direct + indirect-via-tool-output variants
    ├── llm02-insecure-output.yaml                 # unsanitised output handling
    ├── llm06-excessive-agency.yaml                # tool misuse, autonomy boundary breaches
    ├── llm07-system-prompt-leakage.yaml           # OWASP v2025 — exfil of operator prompt
    ├── llm08-vector-embedding.yaml                # OWASP v2025 — RAG / embedding poisoning
    ├── llm10-unbounded-consumption.yaml           # OWASP v2025 — runaway loops / cost abuse
    ├── agentic-memory-poisoning.yaml              # cross-session memory contamination
    ├── agentic-tool-misuse.yaml                   # broken-auth / tool-confusion patterns
    └── atlas-v5.4-agentic.yaml                    # AML.T0051, AML.T0075, AML.T0076
```

## Running

```bash
# Single suite against your own target
agentv eval examples/red-team/suites/llm01-prompt-injection.yaml --target your-target

# Filter by governance tag (any built-in jq pipeline works because the metadata
# is present verbatim in the JSONL):
agentv eval examples/red-team/ \
  && jq 'select(.metadata.governance.owasp_llm_top_10_2025 // [] | index("LLM01"))' \
       .agentv/results/runs/default/*/index.jsonl
```

The pack is **opt-in**. It is not bundled into `agentv init` — copy the
suites you want and adapt them to your tools and threat model.

## Seed corpora and licenses

The cases below are inspired by — and in some places adapted from — published
adversarial corpora and security-research write-ups. Every source named here
ships under a permissive license that allows redistribution with attribution;
no entry in this pack contains explicit harmful payloads (CSAM, weapon
synthesis, self-harm) — those have been curated out by the upstream AI-safety
institutes whose corpora we drew from. Sources: **InjecAgent**
(<https://github.com/uiuc-kang-lab/InjecAgent>, MIT) for indirect-tool-output
injection patterns; **AgentDojo**
(<https://github.com/ethz-spylab/agentdojo>, MIT) for tool-using agent attack
shapes (banking / Slack / travel / workspace); **AgentHarm**
(<https://huggingface.co/datasets/ai-safety-institute/AgentHarm>, MIT) for the
agent-specific harmful-task refusal taxonomy; **NVIDIA Garak**
(<https://github.com/NVIDIA/garak>, Apache-2.0) for direct single-turn probe
ideas; **promptfoo red-team plugins**
(<https://github.com/promptfoo/promptfoo>, MIT) for BOLA / BFLA / RBAC patterns
on agentic APIs; **MITRE ATLAS v5.4** (<https://atlas.mitre.org/>, public)
for the technique IDs (AML.T0051, AML.T0075, AML.T0076); and the public
**OWASP LLM Top 10 v2025** and **OWASP Top 10 for Agentic Applications v2025**
catalogs (<https://owasp.org/>, CC-BY-SA 4.0) for the IDs we tag against.

## Quality bar

- Every case has at least one `owasp_llm_top_10_2025` tag (or
  `owasp_agentic_top_10_2025` for agent-specific cases) and at least one
  `mitre_atlas` tag.
- Cases use **synthetic** placeholder identifiers (`attacker@evil.example`,
  `customer_id=1002`) — no real names, accounts, or addresses.
- Rubrics live in `graders/` and are referenced from the suites via relative
  paths so a copy of the whole directory keeps working.
