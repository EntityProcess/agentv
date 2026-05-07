# OWASP LLM Top 10 v2025

**Canonical IDs for use in `owasp_llm_top_10_2025:` arrays.**

Official source: https://owasp.org/www-project-top-10-for-large-language-model-applications/

| ID | Name | One-line description |
|----|------|----------------------|
| LLM01 | Prompt Injection | Attacker manipulates LLM behavior via crafted inputs (direct or indirect). |
| LLM02 | Sensitive Information Disclosure | LLM reveals confidential data, system prompts, or PII in its output. |
| LLM03 | Supply Chain | Compromised components — plugins, datasets, pre-trained weights — affect the LLM pipeline. |
| LLM04 | Data and Model Poisoning | Training or fine-tuning data is tampered with to alter model behavior. |
| LLM05 | Improper Output Handling | LLM output is passed unsanitized to downstream systems (XSS, SSRF, code injection). |
| LLM06 | Excessive Agency | LLM acts on permissions or capabilities beyond what the task requires. |
| LLM07 | System Prompt Leakage | The system prompt or internal context is exposed to the user or a third party. |
| LLM08 | Vector and Embedding Weaknesses | Adversarial manipulation of embedding stores used for retrieval (RAG poisoning). |
| LLM09 | Misinformation | LLM generates plausible but factually incorrect content that causes harm. |
| LLM10 | Unbounded Consumption | LLM use is abused to exhaust resources — tokens, cost, rate limits, or compute. |

## Usage notes

- Use as many IDs as apply; list them in an array: `owasp_llm_top_10_2025: [LLM01, LLM06]`
- IDs are version-anchored. When OWASP releases a new version, a new field
  (`owasp_llm_top_10_2026`) will be added rather than redefining these IDs.
- Combine with `mitre_atlas` IDs for technique-level tagging.
