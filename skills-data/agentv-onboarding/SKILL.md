---
name: agentv-onboarding
description: Bootstrap AgentV in the current workspace. Ensures CLI availability, runs workspace init, and verifies setup artifacts.
---

# AgentV Onboarding

Use this skill when the user asks to set up AgentV in a repository.

## Goal

Set up AgentV in the current workspace:
- ensure the `agentv` CLI is available (install if needed)
- initialize workspace files
- verify setup artifacts and report status

## Workflow

### 1. Verify the CLI is available

Run `agentv --version` from the repository root.

- If it succeeds, record the version and skip to step 2.
- If `agentv` is not on PATH, install it once with the user's package manager:
  - `bun install -g agentv` (preferred)
  - `npm install -g agentv` (fallback)

Re-check `agentv --version` after install. Stop and report the exact error if it still fails.

### 2. Initialize the workspace

Run from the repository root:

```bash
agentv init
```

This is idempotent — re-running is safe and will fill in any setup artifacts that are still missing.

### 3. Verify setup artifacts

Confirm the expected files exist (e.g. `.agentv/`, `agentv.config.yaml` if applicable).
If verification fails after a fresh `agentv init`, surface the exact error and stop. Do not claim setup succeeded.

### 4. Report outcome

Summarize:
- `agentv` version in use
- whether the CLI was installed during this run
- whether `agentv init` completed successfully
- whether setup verification passed

## Accessing reference files

To load a specific reference without pulling the entire skill into context:

```bash
agentv skills get agentv-onboarding --ref <filename>
```

Or resolve the skill directory and read files directly:

```bash
cat $(agentv skills path agentv-onboarding)/references/<filename>.md
```
