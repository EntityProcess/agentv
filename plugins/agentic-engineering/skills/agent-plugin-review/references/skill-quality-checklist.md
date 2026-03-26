# Skill Quality Checklist

Derived from [Superpowers writing-skills](https://github.com/obra/superpowers/) and [Anthropic's skill authoring best practices](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills).

## Frontmatter

- [ ] Only two fields: `name` and `description` (no other fields supported)
- [ ] Max 1024 characters total in frontmatter
- [ ] `name` uses only letters, numbers, and hyphens (no parentheses, special chars)
- [ ] `description` written in third person
- [ ] `description` starts with "Use when..." focusing on triggering conditions
- [ ] `description` describes WHEN to use, NOT WHAT the skill does
- [ ] `description` does NOT summarize the skill's workflow or process

### Why description must not summarize workflow

Testing revealed that when a description summarizes the skill's workflow, Claude may follow the description instead of reading the full SKILL.md content. A description saying "code review between tasks" caused Claude to do ONE review, even though the SKILL.md flowchart clearly showed TWO reviews. When the description was changed to just triggering conditions, Claude correctly read and followed the full skill.

### Description examples

```yaml
# BAD: Summarizes workflow - Claude may follow this instead of reading skill
description: Use when executing plans - dispatches subagent per task with code review between tasks

# BAD: Too much process detail
description: Use for TDD - write test first, watch it fail, write minimal code, refactor

# BAD: Too abstract, vague
description: For async testing

# BAD: First person
description: I can help you with async tests when they're flaky

# GOOD: Just triggering conditions, no workflow summary
description: Use when executing implementation plans with independent tasks in the current session

# GOOD: Triggering conditions only
description: Use when implementing any feature or bugfix, before writing implementation code

# GOOD: Problem-focused, technology-agnostic
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently
```

## Content Quality

### Conciseness (Claude Search Optimization)

- [ ] SKILL.md body is concise — only include what Claude doesn't already know
- [ ] Content is domain-specific: technology preferences, internal conventions, business domain patterns, industry constraints, context explaining WHY rules exist
- [ ] Universal concepts excluded: standard programming principles (SOLID, DRY, etc.), obvious examples, verbose explanations, best practices AI agents already know
- [ ] Challenge each paragraph: "Does Claude really need this explanation?"
- [ ] Target word counts:
  - Frequently-loaded skills: < 200 words
  - Standard skills: < 500 words
  - With references: SKILL.md lean, details in reference files
- [ ] Move heavy reference (100+ lines) to separate files
- [ ] Use cross-references instead of repeating content from other skills
- [ ] Compress examples — one excellent example beats many mediocre ones

### Structure

- [ ] Overview: core principle in 1-2 sentences
- [ ] When to Use: symptoms and use cases (flowchart only if decision is non-obvious)
- [ ] When NOT to use: explicit exclusions
- [ ] Core Pattern: before/after comparison (for techniques/patterns)
- [ ] Quick Reference: table or bullets for scanning
- [ ] Common Mistakes: what goes wrong + fixes
- [ ] Inline code for simple patterns, separate file for heavy reference

### Writing Style

- [ ] Imperative/infinitive form (verb-first instructions)
- [ ] NOT second person ("you should...")
- [ ] Technology-agnostic triggers unless skill is technology-specific
- [ ] Keywords throughout for search discovery (error messages, symptoms, synonyms, tool names)

### Degrees of Freedom

Match specificity to the task's fragility:

| Freedom Level | When to Use | Example |
|---|---|---|
| High (text instructions) | Multiple valid approaches, context-dependent | Code review process |
| Medium (pseudocode/templates) | Preferred pattern exists, some variation OK | Report generation |
| Low (exact scripts) | Precise steps required, fragile operations | Database migration |

## File Organization

- [ ] Flat namespace — all skills in one searchable directory
- [ ] Supporting files only for: heavy reference (100+ lines), reusable tools/scripts
- [ ] Everything else inline in SKILL.md
- [ ] No narrative storytelling ("In session 2025-10-03, we found...")
- [ ] No multi-language dilution (one excellent example, not 5 mediocre ones)

## Flowchart Usage

- [ ] Use ONLY for non-obvious decision points, process loops, "A vs B" decisions
- [ ] Never use for: reference material (→ tables), code (→ code blocks), linear instructions (→ numbered lists)
- [ ] Labels must have semantic meaning (not "step1", "helper2")

## Cross-References

- [ ] Use skill name with explicit requirement markers: `**REQUIRED:** Use skill-name`
- [ ] Do NOT use `@` syntax to force-load files (burns context)
- [ ] Do NOT repeat content available in referenced skills

## Anti-Patterns to Flag

| Anti-Pattern | Why It's Bad |
|---|---|
| Narrative examples ("In session X, we found...") | Too specific, not reusable |
| Multi-language examples (JS, Python, Go, etc.) | Mediocre quality, maintenance burden |
| Code in flowcharts | Can't copy-paste, hard to read |
| Generic labels (helper1, step2) | No semantic meaning |
| Version printing instructions | Fragile, rely on git history |
| Hardcoded local paths | Machine-specific, not portable |
| Description summarizes workflow | Claude follows description, skips SKILL.md body |

## Discipline-Enforcing Skills (Additional Checks)

For skills that enforce rules (TDD, verification, coding standards):

- [ ] Specific workarounds explicitly forbidden (not just "don't do X" but "don't keep it as reference, don't adapt it, delete means delete")
- [ ] Rationalization table present (common excuses + reality)
- [ ] Red flags list for self-checking
- [ ] "Spirit vs letter" addressed: "Violating the letter IS violating the spirit"
- [ ] Hard gates at critical decision points
