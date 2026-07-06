# AgentV Examples

This directory contains working examples demonstrating AgentV's evaluation capabilities.

For the authored eval contract behind these examples, start with the
[Eval files](https://agentv.dev/docs/evaluation/eval-files/) reference. The
[Promptfoo parity matrix](https://agentv.dev/docs/reference/promptfoo-parity/)
calls out which fields align with Promptfoo-style evals and which AgentV fields
are repo-native extensions.

## Setup

Examples are self-contained packages with their own dependencies. Before running any example, install dependencies from the repository root:

```bash
# From repository root
bun run examples:install
```

This installs dependencies for all examples. Alternatively, install individually:

```bash
cd examples/features/execution-metrics
bun install
```

## Directory Structure

Examples are organized into two categories:

```
examples/
├── features/       # Feature demonstrations (graders, metrics, SDK)
└── showcase/       # Real-world use cases and end-to-end demos
```

---

## Features

Focused demonstrations of specific AgentV capabilities. Each example includes its own README with details.

- [basic](features/basic/) - Core schema features
- [rubric](features/rubric/) - Rubric-based evaluation
- [trajectory-assertions-simple](features/trajectory-assertions-simple/) - Promptfoo trajectory assertion validation
- [trajectory-assertions-advanced](features/trajectory-assertions-advanced/) - Advanced trajectory assertions with expected_output
- [assert-set](features/assert-set/) - Assertion grouping patterns
- [weighted-graders](features/weighted-graders/) - Weighted graders
- [execution-metrics](features/execution-metrics/) - Metrics tracking (tokens, cost, latency)
- [script-grader-with-llm-calls](features/script-grader-with-llm-calls/) - script graders with target proxy for LLM calls
- [batch-cli](features/batch-cli/) - Batch CLI evaluation
- [document-extraction](features/document-extraction/) - Document data extraction
- [local-cli](features/local-cli/) - Local CLI targets
- [compare](features/compare/) - Baseline comparison
- [deterministic-graders](features/deterministic-graders/) - Deterministic assertions (contains, regex, JSON validation)
- [vitest-workspace-grader](features/vitest-workspace-grader/) - Vitest-style deterministic workspace verifiers
- [workspace-setup-script](features/workspace-setup-script/) - Multi-step environment setup with a `beforeAll` lifecycle extension

### SDK

- [script-grader-sdk](features/script-grader-sdk/) - TypeScript SDK for script graders using `defineScriptGrader()`
- [vitest-workspace-grader](features/vitest-workspace-grader/) - Built-in AgentV adapter for Vitest workspace verifier files
- [sdk-custom-assertion](features/sdk-custom-assertion/) - Custom assertion types using `defineAssertion()`
- [sdk-programmatic-api](features/sdk-programmatic-api/) - Programmatic evaluation using `evaluate()`
- [sdk-eval-authoring](features/sdk-eval-authoring/) - TypeScript `*.eval.ts` authoring using `EvalConfig`
- [sdk-config-file](features/sdk-config-file/) - Typed configuration with `defineConfig()`
- [prompt-template-sdk](features/prompt-template-sdk/) - Custom LLM grader prompts using `definePromptTemplate()`

---

## Showcase

Real-world evaluation scenarios. Each example includes its own README with setup instructions.

- [export-screening](showcase/export-screening/) - Export control risk classification
- [tool-evaluation-plugins](showcase/tool-evaluation-plugins/) - Tool selection and efficiency patterns
- [cw-incident-triage](showcase/cw-incident-triage/) - Incident triage classification
- [psychotherapy](showcase/psychotherapy/) - Therapeutic dialogue evaluation

---

## Writing Your Own Examples

Each example follows this structure:

```
example-name/
├── evals/
│   ├── suite.yaml     # Primary eval file
│   ├── *.eval.ts             # TypeScript eval config (optional)
│   ├── *.ts or *.py          # script graders and helper code (optional)
│   └── *.md                  # LLM grader prompts (optional)
├── scripts/                  # Helper scripts (optional)
├── .agentv/
│   └── targets.yaml          # Target configuration (optional)
├── package.json              # Dependencies (if using @agentv/sdk)
└── README.md                 # Example documentation
```

### Using `@agentv/sdk`

For TypeScript script graders, add a `package.json`:

```json
{
  "name": "my-example",
  "private": true,
  "type": "module",
  "dependencies": {
    "@agentv/sdk": "file:../../../packages/sdk"
  }
}
```

Then write type-safe script graders:

```typescript
#!/usr/bin/env bun
import { defineScriptGrader } from '@agentv/sdk';

export default defineScriptGrader(({ output }) => ({
  pass: (output ?? '').includes('expected'),
  score: (output ?? '').includes('expected') ? 1.0 : 0.0,
  reason: (output ?? '').includes('expected') ? 'Found expected content' : 'Missing expected content',
}));
```
