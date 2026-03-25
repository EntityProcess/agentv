---
name: agent-plugin-review
description: >-
  Use when reviewing an AI plugin pull request, auditing plugin quality before release,
  or when asked to "review a plugin PR", "review skills in this PR", "check plugin quality",
  or "review workflow architecture". Covers skill quality, structural linting, and workflow
  architecture review.
---

# Plugin Review

## Overview

Review AI plugin PRs by running deterministic structural checks first, then applying LLM judgment for skill quality and workflow architecture. Post findings as inline PR comments.

## Process

### Step 1: Structural lint

Run `scripts/lint_plugin.py` against the plugin directory:

```bash
python scripts/lint_plugin.py <plugin-dir> --evals-dir <evals-dir> --json
```

The script checks:
- Every `skills/*/SKILL.md` has a corresponding eval file
- SKILL.md frontmatter has `name` and `description`
- No hardcoded local paths (drive letters, absolute OS paths)
- No version printing instructions
- Referenced files (`references/*.md`) exist
- Commands reference existing skills
- Path style consistency across commands

Report findings grouped by severity (error > warning > info).

### Step 2: Eval lint

If the PR includes eval files, invoke `agentv-eval-review` for AgentV-specific eval quality checks.

### Step 3: Skill quality review (LLM judgment)

For each SKILL.md, check against `references/skill-quality-checklist.md`:

- Description starts with "Use when..." and describes triggering conditions only (not workflow)
- Description does NOT summarize the skill's process — this causes agents to follow the description instead of reading the SKILL.md body
- Body is concise — only include what the agent doesn't already know
- Imperative/infinitive form, not second person
- Heavy reference (100+ lines) moved to `references/` files
- One excellent code example beats many mediocre ones
- Flowcharts only for non-obvious decisions
- Keywords throughout for search discovery
- Cross-references use skill name with requirement markers, not `@` force-load syntax
- Discipline-enforcing skills have rationalization tables, red flags lists, and explicit loophole closures
- Consistency — no contradictions within or across files (tool names, filenames, commands, rules)
- No manual routing workarounds — if AGENTS.md or instruction files contain heavy TRIGGER/ACTION routing tables or skill-chain logic, the skill descriptions are likely too weak. Good descriptions enable auto-discovery without manual routing.

### Step 4: Workflow architecture review (LLM judgment)

For plugins with multi-phase workflows, check against `references/workflow-checklist.md`:

- Hard gates between phases (artifact existence checks)
- Artifact persistence convention (defined output directory)
- Workflow state metadata for cross-session resumption
- Resumption protocol (detect existing artifacts, skip completed phases)
- Standardized error handling with retry
- Trivial change escape hatch
- Artifact self-correction with corrections log
- Learning loop mechanism

### Step 5: Post review

Post findings as inline PR comments at specific line numbers. Group by severity:
- **Critical** — Broken references, missing evals, factual contradictions, missing hard gates
- **Medium** — Naming inconsistencies, hardcoded paths, missing assertions, ad-hoc error handling
- **Low** — Style inconsistencies, description improvements

Use a PR review (not individual comments) to batch all findings.

## Skill Resources

- `scripts/lint_plugin.py` — Deterministic plugin linter (Python 3.11+, stdlib only)
- `references/skill-quality-checklist.md` — Skill quality checklist (CSO, descriptions, content, discipline skills)
- `references/workflow-checklist.md` — Workflow architecture checklist (OpenSpec, hard gates, artifacts)

## External References

For deeper research on challenging reviews, consult these resources via web fetch, deepwiki, or clone the repo locally:

- [Agent Skills specification](https://agentskills.io/specification) — Official SKILL.md format, frontmatter fields, progressive disclosure rules
- [Agent Skills best practices](https://agentskills.io/skill-creation/best-practices) — Context spending, calibrating control, gotchas, scripts, validation loops
- [Agent Skills description optimization](https://agentskills.io/skill-creation/optimizing-descriptions) — Trigger testing, train/validation splits, overfitting avoidance
- [Agent Skills using scripts](https://agentskills.io/skill-creation/using-scripts) — Self-contained scripts, --help, structured output, idempotency, exit codes
- [AgentV documentation](https://agentv.dev/) — Eval YAML schema, assertion types, workspace evals, multi-provider targets
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — Spec-driven development framework (OPSX conventions, artifact graphs, hard gates, delta specs)
- [Superpowers](https://github.com/obra/superpowers/) — Claude Code plugin with `<HARD-GATE>` pattern, brainstorming workflow, skill-based development phases
- [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) — Four-phase workflow (Plan/Work/Review/Compound) with learning loop pattern

## Related Skills

- **agentv-eval-review** — Lint and review AgentV eval files (invoke for eval-specific checks)
- **agent-architecture-design** — Design agent architectures from scratch
