---
"agentv": patch
---

Add functional tool evaluation plugins showcase with mock agent

- Add mock-tool-agent.ts for demonstration of tool evaluation patterns
- Add mock_agent target to showcase targets configuration
- Fix pairwise demo to use expected_messages (reference_answer is derived from last message)
- Update code judge scripts with correct TraceSummary and ToolCall interfaces
- Update README with correct input contract documentation (input vs args field)
- Fix "argument matching" status from "planned" to "built-in" in README
