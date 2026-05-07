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

Lint and review AgentV eval YAML files for structural issues, schema compliance, and quality problems. Apply this checklist deterministically first, then layer LLM judgment for semantic issues a checklist cannot catch.

## Process

### Step 1: Structural checklist

Walk every target eval file and report violations grouped by severity (error > warning > info). For each finding, include the file path and a concrete fix.

- File extension is `.eval.yaml` (error if not).
- `description` field is present at the top level (error if missing).
- Each entry under `tests` has `id`, `input`, and at least one of `criteria` / `expected_output` / `assertions` (error if missing).
- File-typed inputs (`type: file`) use a leading `/` in their `path` (error if relative).
- Tests have an `assertions` block — flag tests that rely solely on `expected_output` (warning).
- Detect `expected_output` prose patterns like "The agent should…" or "The output is…" (warning — prose belongs in `criteria`, structured matches in `assertions`).
- Identical file inputs repeated across multiple tests in the same eval should be hoisted to a top-level `input` (info).
- Eval files in the same directory should share a common `id` prefix (info — flag drift).

### Step 2: Semantic review (LLM judgment)

The structural checklist catches mechanical issues but cannot assess:
- **Factual accuracy** — Do tool/command names in expected_output match what the skill documents?
- **Coverage gaps** — Are important edge cases missing?
- **Assertion discriminability** — Would assertions pass for both good and bad output?
- **Cross-file consistency** — Do output filenames match across evals and skills?

Read the relevant SKILL.md files and cross-check against the eval content for these issues.

## Accessing reference files

To load a specific reference without pulling the entire skill into context:

```bash
agentv skills get agentv-eval-review --ref <filename>
```

Or resolve the skill directory and read files directly:

```bash
cat $(agentv skills path agentv-eval-review)/references/<filename>.md
```
