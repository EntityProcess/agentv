---
name: hs-design
description: >-
  Use when a feature or change needs a design before implementation, when the scope
  is non-trivial, when asked to "brainstorm", "design this", "write a spec", "propose
  approaches", or when multiple valid implementation strategies exist. Produces an
  approved design spec through collaborative dialogue.
---

# Design

## Overview

Turn exploration findings into a validated design through collaborative dialogue. Prevents implementation without an approved spec.

## Process

### Step 1: Assess scope

If the change is too large for a single design session, decompose into sub-projects first. Each sub-project gets its own design cycle.

### Step 2: Clarifying questions

Ask questions one at a time. Prefer multiple choice over open-ended:

```
Should this support both CLI and API modes?
a) CLI only (simpler, covers current use cases)
b) Both CLI and API (more flexible, more work)
c) API only (if CLI is being deprecated)

Recommendation: (b) — the API mode is needed for pipeline integration.
```

### Step 3: Propose approaches

Present 2-3 approaches with trade-offs and a recommendation:

| Approach | Pros | Cons |
|---|---|---|
| A: Extend existing | Low risk, fast | Limited flexibility |
| B: New abstraction | Clean design | More code to maintain |
| C: External library | Battle-tested | New dependency |

**Recommendation:** Approach A — explain why.

### Step 4: Section-by-section approval

Present the design in sections. Get user approval after each before proceeding:

1. Data model / types
2. API / interface changes
3. Implementation approach
4. Migration / backward compatibility

### Step 5: Write spec

Save the approved design to the worktree branch:

```
.agents/plans/YYYY-MM-DD-<topic>-design.md
```

### Step 6: Self-review

Before presenting the spec to the user, check:

- No placeholders ("TBD", "to be determined", "similar to above")
- No ambiguous language ("might", "could potentially", "if needed")
- Consistent naming throughout
- All decisions from the dialogue are captured
- Acceptance signals are concrete and testable

### Step 7: User reviews written spec

The user reviews the written spec file. Design is not approved until the user confirms.

## Hard Gate

No implementation until design is approved. Every project, regardless of perceived simplicity. The thought "this is too simple to need a design" is the strongest signal that a design is needed.

## Visual Companions

For UI changes, include mockups or wireframes (ASCII, Mermaid, or browser-based) alongside the spec. Visual designs prevent misalignment more effectively than prose.
