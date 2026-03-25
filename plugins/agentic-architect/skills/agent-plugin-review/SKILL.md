---
name: agent-plugin-review
description: >-
  Review AI plugin pull requests for skill quality, eval correctness, and workflow architecture.
  This skill should be used when asked to "review a plugin PR", "review skills in this PR",
  "check eval quality", "review workflow architecture", or when reviewing any PR that adds or
  modifies SKILL.md files, eval YAML files, commands, or plugin structure.
  Do NOT use for running evals (use agentv-bench) or writing evals (use agentv-eval-writer).
---

# Plugin Review Skill

## Purpose

Review AI plugin PRs across three dimensions: skill quality, eval correctness, and workflow architecture. Produce actionable inline comments on the PR with specific file paths and line numbers.

## When to Use

- Reviewing a PR that adds or modifies skills, evals, commands, or plugin structure
- Auditing an existing plugin for quality before release
- Checking whether a plugin's workflow aligns with spec-driven development patterns

## Review Process

### Step 1: Understand the PR

Read the PR diff and categorize changed files:

| File Type | Review Focus |
|---|---|
| `SKILL.md` | Frontmatter, description triggers, content quality, line count |
| `*.eval.yaml` / `*.yaml` (evals) | Schema compliance, assertions, naming, file references |
| `commands/*.md` | Frontmatter, skill references, path consistency |
| `AGENTS.md` | Routing rules, trigger/action consistency |
| `*.instructions.md` | Scope, applyTo patterns, content weight |
| `references/` | Cross-references from SKILL.md, completeness |

### Step 2: Review Skills

For each SKILL.md file, check against `references/skill-quality-checklist.md`. Key items:

**Frontmatter (Claude Search Optimization):**
- Only `name` and `description` fields (max 1024 chars total)
- `name` uses only letters, numbers, hyphens (no special chars)
- `description` in third person, starts with "Use when..."
- Description describes WHEN to use (triggering conditions), NOT WHAT the skill does
- Description must NOT summarize the skill's workflow — this causes Claude to follow the description instead of reading the full SKILL.md body
- Description specific enough to avoid false triggers on adjacent skills

**Content quality:**
- Body is concise — only include what Claude doesn't already know
- Imperative/infinitive form, not second person
- Line count under 500 (per repo convention if applicable)
- Heavy reference (100+ lines) moved to `references/` files
- One excellent code example beats many mediocre ones — no multi-language dilution
- Flowcharts only for non-obvious decisions (not for linear instructions or reference)
- Keywords throughout for search discovery (error messages, symptoms, tool names)
- No hardcoded local paths — use configurable defaults or environment variables
- No version printing instructions — rely on git history
- No narrative storytelling ("In session X, we found...")

**Cross-references:**
- All referenced files (`references/*.md`, `scripts/*.py`) actually exist
- Skills referenced by name in other skills actually exist
- Commands that load skills use correct paths (relative within plugin, absolute in evals)
- Use skill name with requirement markers, not `@` force-load syntax

**Workflow coherence:**
- Each skill has a clear single responsibility
- Skills that are part of a multi-phase workflow have consistent artifact contracts
- Hard gates enforce artifact existence before downstream phases proceed

**Discipline-enforcing skills (additional checks):**
- Specific workarounds explicitly forbidden (not just the rule, but named loopholes)
- Rationalization table present (common excuses + reality)
- Red flags list for self-checking

### Step 3: Review Evals

For each eval file, check against `references/eval-checklist.md`. Key items:

**Naming and structure:**
- File uses `.eval.yaml` extension (not bare `.yaml`)
- Filename matches skill name or workflow being tested
- Consistent naming prefix across the plugin's eval files

**Schema compliance:**
- `description` field present at top level
- `tests` array with `id`, `input`, `criteria` per test
- File paths in `type: file` values use leading `/` (absolute from repo root)
- No repeated inputs — use top-level `input` for shared file references

**Assertion quality:**
- `assertions` blocks present (not relying solely on `expected_output` prose)
- Deterministic assertions used where possible (`contains`, `regex`) over `llm-grader`
- `expected_output` contains representative sample output, not evaluation criteria
- If `expected_output` duplicates `criteria`, remove one

**Factual accuracy:**
- Commands referenced in test inputs actually exist
- Tool names match what the skill documents (e.g., skill says `pytest` but eval says `python -m unittest`)
- Output filenames match across evals and skills

**Coverage:**
- Every SKILL.md has a corresponding eval file
- Edge cases tested (empty input, missing prerequisites, error paths)
- For multi-phase workflows, at least 2-3 e2e test cases covering happy path, gate enforcement, and error cascading

### Step 4: Review Workflow Architecture

For plugins with multi-phase workflows, compare against OpenSpec patterns. Load `references/workflow-checklist.md` for the full checklist. Key items:

**Phase coverage:**
- Validate phase (check requirements against real code before design)
- Propose/specify phase (define WHAT and WHY with acceptance criteria)
- Design phase (plan HOW with file-level changes)
- Task extraction (standalone `tasks.md` with checkboxes)
- Implement phase (TDD, repo-specific coding agents)
- Verify phase (build + test + spec traceability)
- Explore mode (research without creating artifacts)

**Workflow mechanics:**
- Hard gates between phases (artifact existence checks)
- Artifact persistence convention (defined output directory)
- Workflow state metadata (YAML file tracking phase completion for cross-session resumption)
- Resumption protocol (detect existing artifacts, skip completed phases)
- Error handling (standardized retry policy, clear failure reporting)
- Trivial change escape hatch (skip phases for small fixes)
- Artifact self-correction (downstream phases can fix upstream errors with a corrections log)

**Learning loop:**
- Mechanism to capture patterns from completed work and feed them back (similar to [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)'s `/ce:compound` phase)

### Step 5: Post Review

Post findings as inline PR comments at specific line numbers. Group by severity:

- **Critical** — Broken references, missing evals, factual contradictions, missing hard gates
- **Medium** — Naming inconsistencies, hardcoded paths, missing assertions, ad-hoc error handling
- **Low** — Style inconsistencies, naming prefix mismatches, description improvements

Use a PR review (not individual comments) to batch all findings into a single submission.

## Skill Resources

- `references/skill-quality-checklist.md` — Skill quality checklist based on Superpowers writing-skills and Anthropic best practices
- `references/eval-checklist.md` — Detailed eval file review checklist
- `references/workflow-checklist.md` — Workflow architecture checklist based on OpenSpec patterns

## External References

For deeper research on challenging reviews, consult these resources via web fetch, deepwiki, or clone the repo locally:

- [AgentV documentation](https://agentv.dev/) — Eval YAML schema, assertion types, workspace evals, multi-provider targets
- [Agent Skills directory](https://agentskills.io/home) — Browse published skills for quality and pattern examples
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — Spec-driven development framework (OPSX conventions, artifact graphs, hard gates, delta specs)
- [Superpowers](https://github.com/obra/superpowers/) — Claude Code plugin with `<HARD-GATE>` pattern, brainstorming workflow, skill-based development phases
- [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) — Four-phase workflow (Plan/Work/Review/Compound) with learning loop pattern

## Related Skills

- **agentv-bench** — Run and grade evals (use after review to validate findings)
- **agentv-eval-writer** — Write or fix eval files (use to address eval issues found during review)
