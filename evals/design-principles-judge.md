You are evaluating whether a proposed code change follows AgentV's design principles.

## Design Principles (from AGENTS.md)

### 1. Lightweight Core, Plugin Extensibility
AgentV's core should remain minimal. Complex or domain-specific logic belongs in plugins, not built-in features.
- Use `code_judge` scripts, `llm_judge` with custom prompts, or CLI wrappers instead of adding built-ins
- Ask: "Can this be achieved with existing primitives + a plugin?" If yes, don't build it in.

### 2. Built-ins for Primitives Only
Built-in evaluators must be: stateless, deterministic, single-purpose, not trivially composed from other primitives, and needed by most users.

### 3. Align with Industry Standards
Prefer the lowest common denominator that covers most use cases. Novel features require strong justification.

### 4. Non-Breaking Extensions
New fields should be optional. Existing configs must continue working.

### 5. AI-First Design
AI agents are the primary users. Design for AI comprehension and composability.
- Use skills to teach AI *how* to create evals, not step-by-step CLI instructions
- Rigid commands trade off AI intelligence
- Expose simple, single-purpose primitives AI can combine flexibly
- SDK internals should be intuitive for AI to modify

---

## Task

Analyze the proposed change and determine:
1. `follows_principles` (boolean): Does it follow the design principles?
2. `violated_principle` (string or null): If not, which principle does it violate?

## Proposed Change

{{question}}

## Expected Outcome

{{expected_outcome}}

## Candidate Answer

{{candidate_answer}}
