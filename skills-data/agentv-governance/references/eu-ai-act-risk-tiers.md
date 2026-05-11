# EU AI Act — Risk Tiers

**Valid values for the `risk_tier:` field.**

Official source: Regulation (EU) 2024/1689 on Artificial Intelligence (EU AI Act)
Full text: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689

## Allowed values

| Value | EU AI Act category | Key articles | Description |
|-------|-------------------|-------------|-------------|
| `prohibited` | Prohibited AI practices | Art. 5 | AI systems whose risks are deemed unacceptable — banned outright. Examples: social scoring by public authorities, real-time remote biometric surveillance in public spaces, AI that exploits vulnerabilities of specific groups. |
| `high` | High-risk AI systems | Art. 6, Annex I–III | AI systems subject to mandatory conformity assessments, transparency, and human oversight. Examples: biometric identification, critical infrastructure, employment screening, access to education or essential services, law enforcement. |
| `limited` | Limited-risk AI systems | Art. 50 | AI systems with transparency obligations only. Examples: chatbots must disclose they are AI; deep-fake generators must mark synthetic media. |
| `minimal` | Minimal-risk AI systems | — | No mandatory obligations. Examples: spam filters, AI in video games. Voluntary codes of conduct encouraged. |

## Usage notes

- `risk_tier` is a scalar; only one value per governance block.
- The vocabulary is anchored to EU AI Act terminology. Some organizations use different
  risk scales (e.g. NIST SP 800-30 `low | moderate | high | very_high`). When mapping
  from another framework, choose the EU AI Act equivalent that best matches the impact.
- Combine `risk_tier: high` with `controls` referencing EU AI Act articles:
  ```yaml
  risk_tier: high
  controls:
    - EU-AI-ACT-2024:Art.55
    - EU-AI-ACT-2024:Art.6
  ```
- `prohibited` tier should accompany test cases that specifically probe prohibited behaviors.
  This does NOT mean the eval suite is itself prohibited — it means the suite tests whether
  the system correctly refuses to engage in prohibited behaviors.

## Article reference format

Use `EU-AI-ACT-2024:<Article>` in the `controls` array, e.g. `EU-AI-ACT-2024:Art.55`.
Article 55 covers general-purpose AI (GPAI) model obligations and transparency requirements.
