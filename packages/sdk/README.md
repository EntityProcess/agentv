# @agentv/sdk

Public lightweight SDK for AgentV - run evaluations programmatically, build YAML-aligned eval suites, and write custom assertions, script graders, and prompt templates around the canonical AgentV eval model.

## Installation

```bash
npm install @agentv/sdk
```

## Migrating from `@agentv/eval`

Use `@agentv/sdk` for new code:

```bash
npm uninstall @agentv/eval
npm install @agentv/sdk
```

```typescript
import { defineScriptGrader } from '@agentv/sdk';
```

`@agentv/eval` was a temporary deprecated compatibility package for this SDK. It is no longer published from this repository. Use `@agentv/sdk` directly.

## Quick Start

### evaluate (programmatic runs)

```typescript
import { evaluate } from '@agentv/sdk';

const { results, summary } = await evaluate({
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'greeting',
      vars: { input: 'Say hello' },
      expectedOutput: 'Hello there!',
      assert: [{ type: 'contains', value: 'Hello' }],
    },
  ],
  task: async (input) => `Hello from: ${input}`,
});

console.log(`${summary.passed}/${summary.total} passed`);
```

Use `specFile` when you want library control around an existing YAML suite:

```typescript
import { evaluate } from '@agentv/sdk';

const { summary } = await evaluate({
  specFile: './evals/my-eval.eval.yaml',
});
```

The `evaluate()` implementation is owned by `@agentv/core`; `@agentv/sdk` re-exports it as the user-facing SDK entrypoint.

### defineAssertion (simplest way)

```typescript
#!/usr/bin/env bun
import { defineAssertion } from '@agentv/sdk';

export default defineAssertion(({ output }) => ({
  pass: (output ?? '').toLowerCase().includes('hello'),
  score: (output ?? '').toLowerCase().includes('hello') ? 1 : 0,
  reason: 'Checks for greeting',
}));
```

Checks support `pass: boolean` for simple checks and `score: number` (0-1) for granular scoring.
`checks` is an SDK/script convenience shape; public `grading.json` artifacts
normalize checks into recursive `component_results` with `pass`, `score`, and
`reason`.

### defineScriptGrader (full control)

```typescript
#!/usr/bin/env bun
import { defineScriptGrader } from '@agentv/sdk';

export default defineScriptGrader(({ output, traceSummary }) => ({
  pass: (output ?? '').length > 0 && traceSummary !== null,
  score: (output ?? '').length > 0 ? 1.0 : 0.0,
  reason: 'Checks output presence and trace availability',
  checks: [
    {
      text: 'Output received',
      pass: (output ?? '').length > 0,
      reason: (output ?? '').length > 0 ? 'Output is non-empty' : 'Output is empty',
    },
    {
      text: 'Trace summary available',
      pass: traceSummary !== null,
      reason: traceSummary !== null ? 'Trace summary is present' : 'Trace summary is missing',
    },
  ],
}));
```

Both functions handle stdin/stdout parsing, snake_case conversion, Zod validation, and error handling automatically. Use `defineAssertion()` for reusable assertion types discovered from `.agentv/assertions/`; use `defineScriptGrader()` for command-backed graders referenced with `type: script` and `command:`.

### Vitest workspace verifiers (preferred deterministic workspace checks)

Use normal Vitest tests when deterministic workspace checks can be expressed with `expect(...)`:

```typescript
// graders/welcome-banner.test.ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('links to the dashboard', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  expect(page).toMatch(/href=["']\/dashboard["']/);
});
```

Then reference the verifier directly from eval YAML through AgentV's built-in script-grader adapter:

```yaml
assert:
  - metric: vitest-welcome-banner
    type: script
    command: [agentv, eval, graders/welcome-banner.test.ts]
```

The command reads the normal script-grader stdin payload, runs Vitest in `workspace_path`, maps each Vitest test to an AgentV check, and computes score as `passed / total`.

Use the explicit `agentv eval vitest` subcommand when you need adapter options such as `--cwd`, `--in-workspace`, or `--vitest-command`. Use `defineVitestWorkspaceGrader` when embedding this adapter in a custom script:

```typescript
#!/usr/bin/env bun
import { defineVitestWorkspaceGrader } from '@agentv/sdk';

export default defineVitestWorkspaceGrader({
  testFile: 'graders/welcome-banner.test.ts',
  copyTestFilesToWorkspace: true,
});
```

### defineWorkspaceGrader (small file checks)

Use `defineWorkspaceGrader` when a deterministic grader needs to inspect files in the evaluated workspace:

```typescript
#!/usr/bin/env bun
import { defineWorkspaceGrader } from '@agentv/sdk';

export default defineWorkspaceGrader(async ({ workspace }) => [
  await workspace.file('app/page.tsx').contains('Status: All systems ready'),
  await workspace.file('app/page.tsx').contains('Open dashboard'),
  await workspace.file('app/page.tsx').matches(/href=["']\/dashboard["']/),
  await workspace.file('app/page.tsx').notMatches(/TODO/i),
]);
```

The helper resolves `workspace_path` or `AGENTV_WORKSPACE_PATH`, reads files relative to the workspace, returns AgentV check objects, and computes `score` as passed checks divided by total checks. Prefer Vitest verifiers for checks that naturally fit a test file; use this lower-level helper for tiny one-off graders or custom score shaping.

### TypeScript eval config authoring

```typescript
// evals/greeting.eval.ts
import { graders, type EvalConfig } from '@agentv/sdk';

const config: EvalConfig = {
  name: 'hello-suite',
  providers: [
    { id: 'mock', label: 'mock-sdk', config: { response: 'Hello from the mock provider' } },
    { id: 'openai:gpt-5-mini', label: 'grader-provider' },
  ],
  defaults: {
    provider: 'mock-sdk',
    grader: 'grader-provider',
  },
  defaultTest: {
    options: {
      provider: 'grader-provider',
    },
  },
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'hello',
      vars: { input: 'Say hello' },
      expectedOutput: 'Hello from the mock provider',
      options: {
        provider: 'grader-provider',
      },
      assert: [graders.contains('Hello')],
    },
  ],
};

export default config;
```

AgentV loads explicit `*.eval.ts` and `*.eval.mts` files through the same core loader used for YAML evals. The supported TypeScript contract is a default-exported `EvalConfig`. `defineEval(config)` is available as a thin optional helper over the same shape; plain typed default exports are the recommended path.

TypeScript eval configs use the same provider surface as YAML: author systems under test and reusable grader providers in top-level `providers`, use `id` for the backend/spec, use `label` as the stable AgentV identity, and select defaults with `defaults.provider` and `defaults.grader`. Per-test grader provider selection belongs in `defaultTest.options.provider`, `tests[].options.provider`, or assertion-level `provider`.

### Grader helpers

Use the `graders` catalog when you want TypeScript helpers for common AgentV grader configs without creating a new eval vocabulary:

```typescript
import { graders, type EvalConfig } from '@agentv/sdk';

const config: EvalConfig = {
  name: 'grader-helper-suite',
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'json-greeting',
      vars: { input: 'Return a JSON greeting.' },
      assert: [
        graders.contains('Hello', { metric: 'mentions-hello' }),
        graders.regex(/"message"\s*:/, { metric: 'message-key' }),
        graders.json({ metric: 'valid-json', required: true }),
        graders.llmRubric(['Greets the user'], { metric: 'rubric-review' }),
        graders.llmRubric(undefined, {
          metric: 'llm-review',
          prompt: 'Grade whether the answer is useful.',
          provider: 'grader-provider',
        }),
        graders.scriptGrader(['bun', 'run', 'graders/check.ts'], { metric: 'scripted-check' }),
      ],
    },
  ],
};

export default config;
```

The helpers return ordinary `assert` entries such as `type: contains`, `type: llm-rubric`, and `type: script`. Use the shared `transform` option for assertion-level output shaping. CamelCase SDK options such as `minScore` and `maxSteps` lower to canonical YAML keys such as `min_score` and `max_steps`.

If you are coming from Braintrust `scores` or DeepEval metrics, model reusable checks as small AgentV-native helper factories that return these grader configs. They still lower to the same YAML/runtime contract:

```typescript
import { graders, type EvalConfig } from '@agentv/sdk';

function ragFaithfulness() {
  return graders.llmRubric(undefined, {
    metric: 'rag-faithfulness',
    provider: 'grader-provider',
    prompt: 'Grade whether the answer is supported by the provided context.',
  });
}

const config: EvalConfig = {
  name: 'rag-suite',
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'grounded-answer',
      vars: { input: 'Answer using the retrieved context.' },
      assert: [ragFaithfulness()],
    },
  ],
};

export default config;
```

Python workflows should emit canonical YAML/JSONL or implement script graders over the stdin/stdout contract. The repo-local helper under `examples/features/sdk-python/` is an example, not a promised published Python package.

## Exports

- `evaluate(config)` - Run evaluations programmatically from inline tests or an eval spec file
- `defineAssertion(handler)` - Define a custom assertion type (pass/fail + optional score)
- `defineScriptGrader(handler)` - Define a script grader (command-backed full score control)
- `defineVitestWorkspaceGrader(options)` - Embed the Vitest workspace verifier adapter in a custom script
- `defineWorkspaceGrader(handler)` - Define a workspace-aware script grader with file assertion helpers
- `definePromptTemplate(handler)` - Define a dynamic prompt template
- `defineEval(config)` - Optional helper for a default-exported TypeScript `EvalConfig`
- `graders` - Catalog of built-in AgentV grader config helpers
- `containsGrader`, `equalsGrader`, `exactGrader`, `regexGrader`, `isJsonGrader`, `jsonGrader`, `llmRubricGrader`, `scriptGrader` - Named grader helper functions
- `toEvalYamlObject(definition)` / `serializeEvalYaml(definition)` - Lower or serialize canonical eval YAML
- `EvalConfig` - TypeScript eval config authoring type
- `EvalRunResult`, `EvalSummary`, `EvalTestInput`, `EvalAssertionInput` - Programmatic evaluation types
- `AssertionContext`, `AssertionScore` - Assertion types
- `ScriptGraderInput`, `ScriptGraderResult`, `Workspace`, `WorkspaceAssertion` - Grader types
- `TraceSummary`, `Message`, `ToolCall` - Trace data types
- `createTargetClient()` - Runtime target proxy for script graders that explicitly opt into target access; this is not eval authoring syntax.
- `z` - Re-exported Zod for custom config schemas

## Documentation

For complete documentation including:
- Full grader request/result schemas
- Typed config examples
- Execution metrics usage
- Best practices

See the docs site guides under `apps/web/src/content/docs/docs/next/graders/` or run `agentv skills get agentv-eval-writer`.

## Repository

[https://github.com/EntityProcess/agentv](https://github.com/EntityProcess/agentv)

## License

MIT License - see [LICENSE](../../LICENSE) for details.
