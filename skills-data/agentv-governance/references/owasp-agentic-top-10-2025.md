# OWASP Top 10 for Agentic AI v2025

**Canonical IDs for use in `owasp_agentic_top_10_2025:` arrays.**

Official source: https://owasp.org/www-project-top-10-for-large-language-model-applications/
(Agentic AI supplement — see the "Agentic AI" section of the OWASP LLM project)

| ID | Name | One-line description |
|----|------|----------------------|
| T01 | Prompt Injection for Agentic Systems | Attacker plants instructions in agent inputs, tool results, or retrieved content to redirect agent behavior. |
| T02 | Memory Poisoning | Adversarial content is written to agent memory (short- or long-term) to influence future decisions. |
| T03 | Data Exfiltration | Agent is manipulated into leaking sensitive data through tool calls, network requests, or outputs. |
| T04 | Privilege Escalation | Agent acquires or is tricked into using permissions beyond its intended scope. |
| T05 | Misconfigured Agent Networks | Overly permissive trust between orchestrating and sub-agents enables abuse. |
| T06 | Tool and Plugin Misuse | Agent uses legitimate tools (bash, file I/O, API calls) outside their intended purpose or without authorization. |
| T07 | Insecure Credential Storage | Agent stores or transmits credentials in memory, files, or outputs where they can be captured. |
| T08 | Unsafe Agent-to-Agent Communication | Messages between agents are unvalidated, unencrypted, or susceptible to injection. |
| T09 | Supply Chain Compromise | Malicious code in agent plugins, dependencies, or retrieved skill definitions. |
| T10 | Lack of Accountability | Agent actions are not logged or attributable, making audit and incident response impossible. |

## Usage notes

- Combine with `owasp_llm_top_10_2025` IDs for cases that bridge both lists.
  Example: an indirect-prompt-injection attack is LLM01 + T01 + T06 (tool misuse).
- `T01` (Prompt Injection) and `LLM01` (Prompt Injection) are closely related but distinct:
  LLM01 covers LLM-level injection; T01 covers the agent-orchestration dimension.
- List multiple IDs when a test case exercises more than one category:
  `owasp_agentic_top_10_2025: [T01, T06]`
