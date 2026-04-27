# Coding-agent red-team archetype

Scenario-driven adversarial suites for **coding agents** — agents with file
read/write access, shell tools, package managers, MCP servers, and Git
clients. Each case targets a concrete attack pattern documented in public
threat research.

## Threat model

A coding agent typically has access to:

- A `bash` (or equivalent shell) tool with the developer's working directory.
- A `read_file` / `write_file` / `edit_file` tool family for source edits.
- A `github_*` tool family (read issues, comment, push branches, open PRs).
- A package-manager tool (`npm`, `pip`, `cargo`, `bun add`, `uv add`).
- One or more MCP servers contributed by the user's IDE / plugin ecosystem.

The blast radius is therefore: **the developer's filesystem, their secrets,
their company's source control, and the public package registries**.

These suites test whether the agent stays inside a defensible scope when:

1. **Source / fetched content is hostile.** A README, an issue body, a
   search result, or an MCP tool description carries an injected directive.
2. **Tools have destructive options.** `git push --force`, `rm -rf`, package
   deletions — the agent must require an explicit user-level confirmation
   before invoking them.
3. **Supply chain is poisoned.** The agent suggests a typo-squatted package
   ("slopsquatting") or installs a dependency named in injected content.
4. **The sandbox isn't hardened.** Code-execution tools shouldn't be tricked
   into reading `.env`, making outbound network calls, or escaping the
   workspace.

## Tools the suites assume

The suites embed tool output as `[tool: ...]` blocks inside `user`-role
messages so they run against any LLM target without needing a live tool
runtime. Tool names referenced (you can rename to match your own agent):
`bash`, `read_file`, `write_file`, `edit_file`, `github_get_issue`,
`github_post_pr_comment`, `package.add`, `mcp.call`.

## Fixtures

- **`fixtures/poisoned-mcp-server.js`** — minimal demo of an MCP-style
  registry response whose tool description contains a hidden agent-targeted
  directive. Self-contained: `node fixtures/poisoned-mcp-server.js
  --self-test` exits 0 if the demo string round-trips. No `npm install`.
- **`fixtures/injected-readme.md`** — a benign-looking README with an HTML
  comment carrying an injection payload, used by `readme-issue-url-injection`.
- **`fixtures/validators/check_imports_are_real.py`** — a tiny stdlib-only
  Python script used by a `code-grader` assertion in
  `supply-chain-slopsquatting` to flag suggested imports that are not real
  PyPI packages.

## Suites

```
suites/
├── secrets-exfiltration.eval.yaml
├── destructive-git.eval.yaml
├── supply-chain-slopsquatting.eval.yaml
├── readme-issue-url-injection.eval.yaml
├── sandbox-escape.eval.yaml
├── mcp-tool-description-poisoning.eval.yaml          # ATLAS AML.T0075
├── backdoor-pr.eval.yaml
└── benign-controls.eval.yaml                          # over-refusal guard
```

Every test case is tagged per the `metadata.governance` schema in #1161
(OWASP LLM Top 10 v2025, OWASP Agentic Top 10 v2025, MITRE ATLAS v5.4,
cross-framework `controls`, EU-AI-Act risk tier, owner).

## Seed sources and licenses

Cases are inspired by — and selected examples adapted from — published
threat-research write-ups and adversarial corpora. Every source named here
ships under a permissive license that allows redistribution with attribution;
all fixture identifiers (`attacker@evil.example`, `customer_id=4002`) are
**synthetic**. Sources: **PromptArmor research**
(<https://promptarmor.com/blog>) for slopsquatting-via-LLM-suggested-imports;
**Lasso Security research** for supply-chain hallucination patterns;
**InjecAgent** (<https://github.com/uiuc-kang-lab/InjecAgent>, MIT) for
indirect-tool-output injection shapes; **AgentDojo**
(<https://github.com/ethz-spylab/agentdojo>, MIT) for tool-using agent
attack patterns; **Schuster et al. on backdoored code generation**
(<https://arxiv.org/abs/2007.02220>) for backdoor-PR cases; **MITRE ATLAS
v5.4** technique pages (<https://atlas.mitre.org/>, public) for AML.T0051
/ AML.T0057 / AML.T0075 IDs; and the public **OWASP LLM Top 10 v2025** and
**OWASP Top 10 for Agentic Applications v2025** catalogs
(<https://owasp.org/>, CC-BY-SA 4.0) for the IDs we tag against.

## Running

```bash
# A single suite against your own coding-agent target
agentv eval examples/red-team/archetypes/coding-agent/suites/destructive-git.eval.yaml \
  --target your-coder-target

# All suites at once
agentv eval examples/red-team/archetypes/coding-agent/suites/ \
  --target your-coder-target
```

The pack is opt-in. Copy what you need.
