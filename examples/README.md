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

## Directory Structure

Examples are organized into two categories:

```
examples/
├── features/       # Feature demonstrations (evaluators, metrics, SDK)
└── showcase/       # Real-world use cases and end-to-end demos
```

---

## Features

Focused demonstrations of specific AgentV capabilities.

| Example | Description |
|---------|-------------|
| [basic](features/basic/) | Core schema: `input_messages`, `expected_messages`, file references, conversation threading |
| [rubric](features/rubric/) | Rubric-based evaluation with weights, required flags, and auto-generation |
| [tool-trajectory](features/tool-trajectory/) | Tool trajectory validation: `any_order`, `in_order`, `exact` modes |
| [composite](features/composite/) | Composite evaluator patterns |
| [weighted-evaluators](features/weighted-evaluators/) | Weighted evaluator configurations |
| [execution-metrics](features/execution-metrics/) | Execution metrics tracking (tokens, cost, latency) |
| [code-judge-sdk](features/code-judge-sdk/) | TypeScript SDK for writing code judges with `@agentv/eval` |
| [batch-cli](features/batch-cli/) | Batch evaluation with CLI targets |
| [document-extraction](features/document-extraction/) | Invoice data extraction with field accuracy evaluation |
| [local-cli](features/local-cli/) | CLI target with file attachments |
| [compare](features/compare/) | Baseline vs candidate comparison |

### Running Feature Examples

```bash
# From repository root
bun agentv eval examples/features/basic/evals/dataset.yaml

# With a specific target
bun agentv eval examples/features/rubric/evals/dataset.yaml --target mock
```

---

## Showcase

Real-world evaluation scenarios demonstrating end-to-end patterns.

| Example | Description |
|---------|-------------|
| [export-screening](showcase/export-screening/) | Export control risk classification with confusion matrix metrics and CI/CD integration |
| [tool-evaluation-plugins](showcase/tool-evaluation-plugins/) | Plugin patterns for tool selection, efficiency scoring, and pairwise comparison |
| [cw-incident-triage](showcase/cw-incident-triage/) | Incident triage classification |
| [psychotherapy](showcase/psychotherapy/) | Therapeutic dialogue evaluation |

### Running Showcase Examples

Each showcase has its own README with specific setup instructions. Generally:

```bash
cd examples/showcase/export-screening
bun agentv eval ./evals/dataset.yaml --out results.jsonl
```

---

## Writing Your Own Examples

Each example follows this structure:

```
example-name/
├── evals/
│   ├── dataset.yaml          # Primary eval file
│   ├── *.ts or *.py          # Code evaluators (optional)
│   └── *.md                  # LLM judge prompts (optional)
├── scripts/                  # Helper scripts (optional)
├── .agentv/
│   └── targets.yaml          # Target configuration (optional)
├── package.json              # Dependencies (if using @agentv/eval)
└── README.md                 # Example documentation
```

### Using `@agentv/eval` SDK

For TypeScript code judges, add a `package.json`:

```json
{
  "name": "my-example",
  "private": true,
  "type": "module",
  "dependencies": {
    "@agentv/eval": "file:../../../packages/eval"
  }
}
```

Then write type-safe code judges:

```typescript
#!/usr/bin/env bun
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ candidateAnswer, expectedOutcome }) => ({
  score: candidateAnswer.includes('expected') ? 1.0 : 0.0,
  hits: ['Found expected content'],
  misses: [],
}));
```
