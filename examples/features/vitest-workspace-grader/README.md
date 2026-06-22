# Vitest Workspace Grader

Demonstrates the preferred deterministic workspace grader path: write normal Vitest tests with `expect(...)`, then use the thin `@agentv/sdk` adapter to map test results into AgentV assertions.

## Files

- `workspace-template/verifiers/welcome-banner.test.ts`: plain Vitest verifier that reads `app/page.tsx`
- `graders/verify-welcome-banner.ts`: tiny AgentV wrapper using `defineVitestWorkspaceGrader`
- `evals/dataset.eval.yaml`: eval case that runs the wrapper as a `code-grader`
- `.agentv/targets.yaml`: mock CLI target that updates the workspace

## Run

From this example directory:

```bash
bun install
cd ../../..
bun apps/cli/src/cli.ts eval examples/features/vitest-workspace-grader/evals/dataset.eval.yaml --target mock_agent
```

## Pattern

Use Vitest verifiers when deterministic workspace checks can be expressed as normal tests:

```ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('links to the dashboard', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  expect(page).toMatch(/href=["']\/dashboard["']/);
});
```

The AgentV-specific wrapper stays small:

```ts
import { defineVitestWorkspaceGrader } from '@agentv/sdk';

export default defineVitestWorkspaceGrader({
  testFile: 'verifiers/welcome-banner.test.ts',
});
```

Use lower-level `defineCodeGrader` scripts when the grader needs custom scoring, multi-stage setup, external commands beyond a test runner, or structured `details` that do not map cleanly to individual test outcomes.
