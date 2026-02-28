---
name: agentv-onboarding
description: Bootstrap AgentV in the current workspace after plugin-manager install. Verifies CLI availability, initializes missing files idempotently, and reports what changed.
---

# AgentV Onboarding

Use this skill when the user asks to set up AgentV in a repository.

## Goal

Set up AgentV in the current workspace with an idempotent flow:
- ensure the `agentv` CLI is available (install/update if needed)
- initialize workspace files without overwriting existing user edits
- verify setup artifacts and report status

## Workflow

### 1. Verify `agentv` CLI

Run:

```bash
agentv --version
```

If command is missing:

```bash
if command -v bun >/dev/null 2>&1; then
  bun add -g agentv@latest
else
  npm install -g agentv@latest
fi
```

If command exists but setup seems stale, update:

```bash
agentv self update
```

### 2. Bootstrap Workspace (Idempotent)

Run:

```bash
agentv init --skip-existing
```

This creates missing files and leaves existing files unchanged.

### 3. Verify Expected Artifacts

Check:

```bash
test -f .env.example
test -f .agentv/targets.yaml
test -f .agents/skills/agentv-eval-builder/SKILL.md
test -f .agents/skills/agentv-onboarding/SKILL.md
```

If any check fails, report which files are missing and rerun `agentv init --skip-existing`.

### 4. Report Outcome Clearly

Summarize:
- `agentv` version in use
- whether CLI was installed or updated
- what files were created vs skipped by `agentv init --skip-existing`
- whether setup verification passed

## Re-run Behavior

This flow is safe to rerun. Existing files are preserved by default.
