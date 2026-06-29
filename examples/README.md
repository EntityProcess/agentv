# AgentV Examples

This directory contains working examples demonstrating AgentV's evaluation capabilities.

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

## Oracle Fixture Sweep

Run the deterministic oracle sweep when you need to prove agent or LLM-backed example evals still parse, execute, write artifacts, and avoid live LLM calls:

```bash
bun run examples:oracle
```

The command discovers eval files under `examples/`, reads `examples/oracle-fixtures.yaml` for explicit exclusions, classifies oracle-capable targets as already covered, generates replay target fixtures under `.agentv/tmp/example-oracle-fixtures/` for evals that otherwise require an agent or LLM target, and runs those evals with an oracle replay target plus an oracle CLI grader target. These fixtures are a contract oracle for example execution, not captured live-model golden transcripts; live provider dogfood remains a separate release-gate workflow. To inspect the inventory without running evals:

```bash
bun run examples:oracle -- --inventory
```

Use `--eval <path>` to run or inventory a single eval file.

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
- [tool-trajectory-simple](features/tool-trajectory-simple/) - Tool trajectory validation
- [tool-trajectory-advanced](features/tool-trajectory-advanced/) - Advanced tool trajectory with expected_output
- [composite](features/composite/) - Composite grader patterns
- [weighted-graders](features/weighted-graders/) - Weighted graders
- [execution-metrics](features/execution-metrics/) - Metrics tracking (tokens, cost, latency)
- [code-grader-with-llm-calls](features/code-grader-with-llm-calls/) - Code graders with target proxy for LLM calls
- [batch-cli](features/batch-cli/) - Batch CLI evaluation
- [document-extraction](features/document-extraction/) - Document data extraction
- [local-cli](features/local-cli/) - Local CLI targets
- [compare](features/compare/) - Baseline comparison
- [deterministic-graders](features/deterministic-graders/) - Deterministic assertions (contains, regex, JSON validation)
- [vitest-workspace-grader](features/vitest-workspace-grader/) - Vitest-style deterministic workspace verifiers
- [workspace-setup-script](features/workspace-setup-script/) - Multi-step workspace setup with `before_all` lifecycle hook

### SDK

- [code-grader-sdk](features/code-grader-sdk/) - TypeScript SDK for code graders using `defineCodeGrader()`
- [vitest-workspace-grader](features/vitest-workspace-grader/) - Built-in AgentV adapter for Vitest workspace verifier files
- [sdk-custom-assertion](features/sdk-custom-assertion/) - Custom assertion types using `defineAssertion()`
- [sdk-programmatic-api](features/sdk-programmatic-api/) - Programmatic evaluation using `evaluate()`
- [sdk-eval-authoring](features/sdk-eval-authoring/) - YAML-aligned `.eval.ts` authoring using `defineEval()`
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
│   ├── dataset.eval.yaml     # Primary eval file
│   ├── *.ts or *.py          # Code graders (optional)
│   └── *.md                  # LLM grader prompts (optional)
├── scripts/                  # Helper scripts (optional)
├── .agentv/
│   └── targets.yaml          # Target configuration (optional)
├── package.json              # Dependencies (if using @agentv/sdk)
└── README.md                 # Example documentation
```

### Using `@agentv/sdk`

For TypeScript code graders, add a `package.json`:

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

Then write type-safe code graders:

```typescript
#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/sdk';

export default defineCodeGrader(({ output }) => ({
  score: (output ?? '').includes('expected') ? 1.0 : 0.0,
  assertions: [{ text: 'Found expected content', passed: (output ?? '').includes('expected') }],
}));
```
