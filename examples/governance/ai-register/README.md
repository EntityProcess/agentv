# `.ai-register.yaml` — Git-native AI system register

A two-file pattern for documenting your AI systems against the governance
frameworks every Year-1 auditor will ask about (NIST AI RMF GOVERN-1.3,
ISO/IEC 42001 Clause 7, EU AI Act Annex IV).

```
your-org/
├── service-a/.ai-register.yaml          # one per AI-system repo
├── service-b/.ai-register.yaml
├── …
└── ai-register/                         # one aggregator repo
    └── .github/workflows/aggregate.yml  # walks the org, builds CSV + HTML
```

The full pattern, motivation, and migration notes are documented in the
agentv.dev guide: **Enterprise governance** at
`/docs/guides/enterprise-governance/`. This directory ships the example
manifest and the aggregator workflow file.

## Contents

- **`.ai-register.yaml`** — example manifest. Drop a copy at the **repo root**
  of each AI system you want to inventory, and edit the fields. `controls`
  uses the same `<FRAMEWORK>-<VERSION>:<ID>` shape as the eval-level
  governance schema, so the same string appears in the manifest and in eval
  result JSONL — that's the correlation point.

- **`.github/workflows/aggregate.yml`** — copy this into a dedicated
  governance repo (commonly named `ai-register`). It runs weekly (and on
  manual dispatch), walks the org for every `.ai-register.yaml`, and uploads
  a CSV + static HTML dashboard as a workflow artifact. Stale entries
  (`last_reviewed` older than `STALE_DAYS`, default 90) surface on the
  workflow summary and can be wired to an issue comment, Slack webhook, or
  whatever notification channel you already use.

## Field reference

| Field | Required by | Notes |
|---|---|---|
| `id` | internal | Stable machine identifier; use in dashboards and audit trails |
| `name` | — | Human-readable display name |
| `version` | EU AI Act Annex IV Art. 11; ISO 42001 A.9; CycloneDX-ML | Version of the AI system (not the underlying model) |
| `owner` | — | Team that owns the system |
| `contact` | EU AI Act Art. 8; NIST RMF GOVERN-2 | Contact surface for compliance inquiries and incident reports |
| `risk_tier` | EU AI Act Art. 6 | `prohibited \| high \| limited \| minimal` |
| `data_classification` | internal data policy | Restrict aggregators from publishing sensitive manifests |
| `created_at` | ISO 42001 A.9 lifecycle records | ISO date; combined with `last_reviewed` tracks system age |
| `description` | — | General description of what the system does |
| `intended_use` | EU AI Act Annex IV §1(a); NIST RMF GOVERN-1.1 | Authorised contexts — separate from general description |
| `limitations` | NIST RMF MEASURE-1.1; EU AI Act Annex IV §2 | Known failure modes and out-of-scope uses |
| `human_oversight` | EU AI Act Art. 14; NIST RMF GOVERN-4 | Required for `risk_tier: high`. Document override authority and escalation triggers |
| `models[]` | — | Versioned model identifiers so auditors can reconstruct which model was running at any point in time |
| `evals.path` | — | Path to agentv evals that exercise this system |
| `controls[]` | — | `<FRAMEWORK>-<VERSION>:<ID>` strings; same format as eval result JSONL |
| `last_reviewed` | NIST RMF GOVERN-1.3; ISO 42001 Clause 7 | Aggregators flag entries older than your governance cadence (90 days typical) |

## Why this stays out of agentv core

agentv does not parse `.ai-register.yaml`. The convention is deliberately
free-standing: if you later adopt a governance platform (Credo AI, OneTrust,
ServiceNow AI Control Tower, IBM watsonx.governance), these manifests are
your import source — not a thing you need to migrate away from.

If the convention grows, that growth happens in conversation between teams
adopting it; agentv stays lightweight.
