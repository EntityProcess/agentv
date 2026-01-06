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

Focused demonstrations of specific AgentV capabilities. Each example includes its own README with details.

- [basic](features/basic/) - Core schema features
- [rubric](features/rubric/) - Rubric-based evaluation
- [tool-trajectory-simple](features/tool-trajectory-simple/) - Tool trajectory validation
- [tool-trajectory-advanced](features/tool-trajectory-advanced/) - Advanced tool trajectory with expected_messages
- [composite](features/composite/) - Composite evaluator patterns
- [weighted-evaluators](features/weighted-evaluators/) - Weighted evaluators
- [execution-metrics](features/execution-metrics/) - Metrics tracking (tokens, cost, latency)
- [code-judge-sdk](features/code-judge-sdk/) - TypeScript SDK for code judges
- [batch-cli](features/batch-cli/) - Batch CLI evaluation
- [document-extraction](features/document-extraction/) - Document data extraction
- [local-cli](features/local-cli/) - Local CLI targets
- [compare](features/compare/) - Baseline comparison

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
