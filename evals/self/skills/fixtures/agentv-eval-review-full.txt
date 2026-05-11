---
name: agentv-eval-review
description: >-
  Use when reviewing eval YAML files for quality issues, linting eval files before
  committing, checking eval schema compliance, or when asked to "review these evals",
  "check eval quality", "lint eval files", or "validate eval structure".
  Do NOT use for writing evals (use agentv-eval-writer) or running evals (use agentv-bench).
---

# Eval Review

## Overview

Lint and review AgentV eval YAML files for structural issues, schema compliance, and quality problems. Runs deterministic checks via script, then applies LLM judgment for semantic issues the script cannot catch.

## Process

### Step 1: Run the linter

Execute `scripts/lint_eval.py` against the target eval files:

```bash
python scripts/lint_eval.py <path-to-evals-dir-or-file> --json
```

The script checks:
- `.eval.yaml` extension
- `description` field present
- Each test has `id`, `input`, and at least one of `criteria`/`expected_output`/`assertions`
- File paths in `type: file` use leading `/`
- `assertions` blocks present (flags tests relying solely on `expected_output`)
- `expected_output` prose detection (flags "The agent should..." patterns)
- Repeated file inputs across tests (recommends top-level `input`)
- Naming prefix consistency across eval files in same directory

### Step 2: Review script output

Report the script findings grouped by severity (error > warning > info). For each finding, include the file path and a concrete fix.

### Step 3: Semantic review (LLM judgment)

The script catches structural issues but cannot assess:
- **Factual accuracy** — Do tool/command names in expected_output match what the skill documents?
- **Coverage gaps** — Are important edge cases missing?
- **Assertion discriminability** — Would assertions pass for both good and bad output?
- **Cross-file consistency** — Do output filenames match across evals and skills?

Read the relevant SKILL.md files and cross-check against the eval content for these issues.

## Skill Resources

- `scripts/lint_eval.py` — Deterministic eval linter (Python 3.11+, stdlib only)
