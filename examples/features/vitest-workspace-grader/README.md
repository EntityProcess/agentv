# Vitest Workspace Grader

Demonstrates the preferred deterministic workspace grader path: write normal Vitest tests with `expect(...)`, then let AgentV run the verifier and map test results into AgentV assertions.

## Files

- `graders/welcome-banner.test.ts`: plain Vitest verifier that reads `app/page.tsx`
- `evals/dataset.eval.yaml`: eval case that runs the verifier through `agentv eval <verifier.test.ts>`
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

The eval YAML calls AgentV's built-in adapter directly:

```yaml
assertions:
  - name: vitest-welcome-banner
    type: code-grader
    command: [agentv, eval, graders/welcome-banner.test.ts]
```

AgentV infers the built-in Vitest adapter for `*.test.ts`, `*.spec.ts`, and Vercel-style `EVAL.ts` verifier files. The local example uses a source-relative CLI path so it can run before the next AgentV package release. In a normal project, use the installed `agentv` binary form above.

Use lower-level `defineCodeGrader` scripts when the grader needs custom scoring, multi-stage setup, external commands beyond a test runner, or structured `details` that do not map cleanly to individual test outcomes.
