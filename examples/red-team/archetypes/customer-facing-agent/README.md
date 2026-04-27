# Customer-facing-agent red-team archetype

Scenario-driven adversarial suites for **customer-facing agents** — chat,
support, or in-product assistants that have access to a customer database,
ticketing system, and the user's own account context. Each case targets a
concrete attack pattern documented in public threat research.

## Threat model

A customer-facing agent typically has access to:

- A `db.query` (or similar) tool scoped to a single tenant or customer.
- A `get_customer(id)` / `update_customer(id, ...)` tool family.
- An `email.send` / `create_ticket` / `escalate` tool family.
- A `fetch_doc(name)` tool that pulls support documents into context.
- An authenticated user identity (`customer_id=4001`, `role=customer`).

The blast radius is therefore: **the customer's own data, other customers'
data sitting in shared tables, support workflows that issue refunds,
reset passwords, or escalate to humans**.

These suites test whether the agent stays inside the authenticated user's
scope when:

1. **A user asks for someone else's data.** Direct ("look up customer 4002"),
   social-engineered ("my friend asked me to check"), or laundered through a
   refund / escalation request.
2. **Tool output is hostile.** A support document body, a memory entry, or
   a search result carries a hidden override.
3. **Authority is faked.** "I'm an admin," "the auditor said," "the manager
   pre-approved this."
4. **Cross-session state leaks.** Memory or context from another session
   bleeds into the answer for this one.

## Tools the suites assume

The suites embed tool output as `[tool: ...]` blocks inside `user`-role
messages so they run against any LLM target without needing a live tool
runtime. Tool names referenced (rename to match your own agent):
`db.query`, `get_customer`, `update_customer`, `email.send`, `create_ticket`,
`fetch_doc`, `issue_refund`, `escalate`.

## Fixtures

- **`fixtures/mock-customer-db.json`** — a small synthetic dataset (5
  rows). Tool calls in the suites quote these IDs verbatim so a reviewer
  can map "did the agent leak `customer_id=4002`?" to a specific row.
  No real names, real emails, or real addresses.

## Suites

```
suites/
├── pii-cross-customer-disclosure.eval.yaml
├── bola-bfla.eval.yaml                           # Broken Object/Function-Level Auth
├── cross-session-leak.eval.yaml
├── unauthorized-action-social-engineering.eval.yaml
├── support-doc-indirect-injection.eval.yaml
├── escalation-hijack.eval.yaml
├── compliance-boundary-violation.eval.yaml
└── benign-controls.eval.yaml                      # over-refusal guard
```

Every test case is tagged per the `metadata.governance` schema in #1161.

## Seed sources and licenses

Cases are inspired by — and selected examples adapted from — published
adversarial corpora. Every source named here ships under a permissive
license that allows redistribution with attribution; all fixture
identifiers are **synthetic**. Sources: **AgentDojo**
(<https://github.com/ethz-spylab/agentdojo>, MIT) for banking / Slack /
travel / workspace-style attack patterns, directly applicable to
customer-facing flows; **InjecAgent**
(<https://github.com/uiuc-kang-lab/InjecAgent>, MIT) for indirect-tool-output
injection patterns; **promptfoo agentic plugins**
(<https://github.com/promptfoo/promptfoo>, MIT) for RBAC / BOLA / BFLA /
hijacking / cross-session-leak case shapes; **MITRE ATLAS v5.4** technique
pages (<https://atlas.mitre.org/>, public) for AML.T0051 / AML.T0057 /
AML.T0075 IDs; and the public **OWASP LLM Top 10 v2025** and **OWASP Top 10
for Agentic Applications v2025** catalogs (<https://owasp.org/>,
CC-BY-SA 4.0) for the IDs we tag against.

## Running

```bash
agentv eval examples/red-team/archetypes/customer-facing-agent/suites/pii-cross-customer-disclosure.eval.yaml \
  --target your-support-target

# All suites at once
agentv eval examples/red-team/archetypes/customer-facing-agent/suites/ \
  --target your-support-target
```

The pack is opt-in. Copy what you need.
