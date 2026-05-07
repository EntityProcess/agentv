# MITRE ATLAS — AI/ML Threat Techniques

**Canonical IDs for use in `mitre_atlas:` arrays.**

Official source: https://atlas.mitre.org/

MITRE ATLAS (Adversarial Threat Landscape for Artificial-Intelligence Systems) documents
adversarial ML and AI attack techniques using the same taxonomy style as MITRE ATT&CK.
IDs follow the pattern `AML.Txxxx` for techniques and `AML.Txxxx.xxx` for sub-techniques.

## Techniques most relevant to LLM / agentic-AI evaluation

| ID | Name | Relevant OWASP IDs |
|----|------|-------------------|
| AML.T0051 | LLM Prompt Injection | LLM01, T01 |
| AML.T0054 | LLM Jailbreak | LLM01 |
| AML.T0056 | LLM Meta Prompt Extraction | LLM07 |
| AML.T0057 | LLM Plugin Compromise | LLM03, T09 |
| AML.T0058 | LLM Data Leakage | LLM02 |
| AML.T0068 | Training Data Poisoning | LLM04 |
| AML.T0075 | Manipulate LLM Inputs | LLM01, T01 |

## Sub-techniques

Sub-techniques extend a base ID with a period-separated suffix, e.g.:
- `AML.T0051.000` — Direct Prompt Injection
- `AML.T0051.001` — Indirect Prompt Injection

Use the base ID if the test covers the whole technique class; use sub-techniques for
more precise tagging when the attack method is specific.

## Usage notes

- List IDs as strings in an array: `mitre_atlas: [AML.T0051, AML.T0075]`
- Cross-reference with OWASP IDs when both frameworks cover the same attack:
  a suite testing indirect prompt injection via tool output should tag
  `owasp_llm_top_10_2025: [LLM01]` and `mitre_atlas: [AML.T0051]`.
- For the full technique catalog, browse https://atlas.mitre.org/techniques/
