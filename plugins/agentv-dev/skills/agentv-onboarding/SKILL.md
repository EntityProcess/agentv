---
name: agentv-onboarding
description: Bootstrap AgentV in the current workspace after plugin-manager install. Ensures CLI availability, runs workspace init, and verifies setup artifacts.
---

# AgentV Onboarding

Use this skill when the user asks to set up AgentV in a repository.

## Goal

Set up AgentV in the current workspace:
- ensure the `agentv` CLI is available (install if needed)
- initialize workspace files
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

### 2. Bootstrap Workspace

Run:

```bash
agentv init
```

### 3. Verify Expected Artifacts

Check:

```bash
test -f .env.example
test -f .agentv/config.yaml
test -f .agentv/targets.yaml
```

If any check fails, report which files are missing and rerun `agentv init`.

### 4. Report Outcome Clearly

Summarize:
- `agentv` version in use
- whether CLI was installed
- whether `agentv init` completed
- whether setup verification passed

## Re-run Behavior

If setup is re-run in a repo with existing AgentV files, `agentv init` may prompt before replacing files.
