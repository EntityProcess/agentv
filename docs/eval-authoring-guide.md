# Eval Authoring Guide

Practical guidance for writing workspace-based evals that work reliably across providers.

## Workspace Setup: Skill Discovery Paths (#834)

The `before_all` setup hook must copy skills to **all** provider discovery paths. Each provider searches a different directory:

| Provider | Discovery path |
|----------|---------------|
| claude-cli | `.claude/skills/` |
| allagents | `.agents/skills/` |
| pi-cli | `.pi/skills/` |

If your setup hook only copies to one path, `skill-trigger` assertions will fail for other providers.

### Example setup.mjs

```javascript
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Read AgentV payload from stdin
const payload = JSON.parse(await new Promise((resolve) => {
  let data = '';
  process.stdin.on('data', (chunk) => (data += chunk));
  process.stdin.on('end', () => resolve(data));
}));

const workspacePath = payload.workspace_path;
const skillSource = path.resolve('skills');

// Copy skills to all provider discovery paths
const discoveryPaths = [
  '.claude/skills',
  '.agents/skills',
  '.pi/skills',
];

for (const rel of discoveryPaths) {
  const dest = path.join(workspacePath, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(skillSource, dest, { recursive: true });
}
```

### In your eval YAML

```yaml
workspace:
  template: ./workspace-template
  hooks:
    before_all:
      command:
        - node
        - ../scripts/setup.mjs
```

## Workspace Limitations: No GitHub Remote (#835)

Workspace-based evals are sandboxed — there is no GitHub remote, no PRs, and no issue tracker. Tests that ask agents to interact with GitHub will fail.

### What to test instead

Test **decision-making discipline**, not git infrastructure operations:

- Risk classification ("should this change be shipped?")
- Scope assessment ("does this PR do too much?")
- Review judgment ("what issues does this diff have?")

### How to frame prompts

**Don't** write imperative prompts that require a remote:

```yaml
# BAD — requires GitHub remote
- id: merge-check
  input: "Merge PR #42 if it looks safe"
```

**Do** frame prompts as hypothetical with inline context:

```yaml
# GOOD — self-contained, no remote needed
- id: merge-check
  input: |
    Here is what PR #42 changes:

    ```diff
    -  timeout: 30_000
    +  timeout: 5_000
    ```

    The PR description says: "Reduce timeout for faster feedback."
    Should this be shipped? What risks do you see?
```

## Workspace State Consistency: Git Diff Verification (#836)

Agents verify `git diff` against prompt claims. If your prompt says "The PR modifies `auth.ts`" but the workspace has no such change, the agent will flag the mismatch. This is **correct agent behavior** — don't try to suppress it.

### Rules

1. If a prompt references specific code changes, the workspace **must** contain those exact changes
2. Or frame prompts as hypothetical: describe changes inline rather than claiming they exist in the workspace
3. Use `before_each` hooks to set up per-test git state when tests need different diffs

### Example: per-test git state

```yaml
workspace:
  template: ./workspace-template
  hooks:
    before_each:
      command:
        - node
        - ../scripts/apply-test-diff.mjs

tests:
  - id: risky-change
    metadata:
      diff_file: diffs/risky-timeout-change.patch
    input: "Review the current changes and assess risk."
```

The `before_each` hook reads `metadata.diff_file` from the AgentV payload and applies the patch to the workspace before each test runs.

### Hypothetical framing pattern

When you don't want to maintain actual diffs, describe the changes inline:

```yaml
- id: ship-decision
  input: |
    You are reviewing a proposed change. Here is the diff:

    ```diff
    --- a/src/config.ts
    +++ b/src/config.ts
    @@ -10,3 +10,3 @@
    -  retries: 3,
    +  retries: 0,
    ```

    The author says: "Disable retries to reduce latency."
    Should this be shipped?
```

This avoids workspace state issues entirely — the agent evaluates the diff as presented without checking `git diff`.
