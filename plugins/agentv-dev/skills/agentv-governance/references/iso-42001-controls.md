# ISO/IEC 42001:2023 — AI Management System Controls

**Curated subset of controls relevant to AI evaluation suites.**

Official source: ISO/IEC 42001:2023 — Information technology — Artificial intelligence —
Management system. Full standard available at https://www.iso.org/standard/81230.html

ISO 42001 is a management-system standard (like ISO 27001 for information security) covering
the governance, risk management, and operational controls for organizations that develop or
deploy AI systems.

## Control reference format

Use `ISO-42001-2023:<Clause>` in the `controls` array.

## Relevant control areas for eval suites

| Clause | Title | Relevance to evals |
|--------|-------|-------------------|
| 6.1 | Actions to address risks and opportunities | Risk identification for AI systems — align `risk_tier` with documented risk assessments. |
| 6.1.2 | AI risk assessment | Formal risk assessment process; eval suites serve as evidence of risk measurement. |
| 8.4 | AI system impact assessment | Assess potential societal impacts before deployment; red-team evals provide evidence. |
| 8.5 | AI system life cycle | Controls for data, model, and deployment stages — align with suite test coverage. |
| 9.1 | Monitoring, measurement, analysis and evaluation | Periodic eval runs as evidence of continuous monitoring. |
| 9.1.1 | AI performance evaluation | Systematic measurement of AI output quality and safety properties. |
| 10.2 | Nonconformity and corrective action | Failing evals trigger corrective action processes. |
| A.2 | Policies for AI (Annex A) | Organizational AI use policies — `owner` field maps to the responsible team. |
| A.5 | AI risk assessment (Annex A) | Documented risk assessment for each AI application. |
| A.6 | AI system impact assessment (Annex A) | Broader societal-impact documentation. |

## Usage example

```yaml
controls:
  - ISO-42001-2023:6.1.2   # AI risk assessment
  - ISO-42001-2023:9.1.1   # AI performance evaluation
  - EU-AI-ACT-2024:Art.55  # GPAI transparency obligations
```

## Notes

- ISO 42001 is certification-oriented; most teams will reference only a subset.
  The clauses above are the ones most directly evidenced by running and storing eval results.
- For pure LLM / red-team suites, clauses 6.1.2, 8.4, and 9.1.1 are the most common references.
- Combine with NIST AI RMF controls (e.g. `NIST-AI-RMF-1.0:MEASURE-2.7`) when the organization
  uses both frameworks.
