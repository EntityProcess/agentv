# Batch CLI Evaluation Guide

Guide for evaluating batch CLI output where a single runner processes all evalcases at once and outputs JSONL.

## Overview

Batch CLI evaluation is used when:
- An external tool processes multiple inputs in a single invocation (e.g., AML screening, bulk classification)
- The runner reads the eval YAML directly to extract all evalcases
- Output is JSONL with records keyed by evalcase `id`
- Each evalcase has its own evaluator to validate its corresponding output record

## Execution Flow

1. **AgentV** invokes the batch runner once, passing `--eval <yaml-path>` and `--output <jsonl-path>`
2. **Batch runner** reads the eval YAML, extracts all evalcases, processes them, writes JSONL output keyed by `id`
3. **AgentV** parses JSONL, routes each record to its matching evalcase by `id`
4. **Per-case evaluator** validates the output for each evalcase independently

## Eval File Structure

```yaml
$schema: agentv-eval-v2
description: Batch CLI demo using structured input_messages

execution:
  target: batch_cli

evalcases:
  - id: case-001
    expected_outcome: |-
      Batch runner returns JSON with decision=CLEAR.

    expected_messages:
      - role: assistant
        content:
          decision: CLEAR  # Structured expected output

    input_messages:
      - role: system
        content: You are a batch processor.
      - role: user
        content:  # Structured input (runner extracts this)
          request:
            type: screening_check
            jurisdiction: AU
          row:
            id: case-001
            name: Example A
            amount: 5000

    execution:
      evaluators:
        - name: decision-check
          type: code_judge
          script: bun run ./scripts/check-output.ts
          cwd: .

  - id: case-002
    expected_outcome: |-
      Batch runner returns JSON with decision=REVIEW.

    expected_messages:
      - role: assistant
        content:
          decision: REVIEW

    input_messages:
      - role: system
        content: You are a batch processor.
      - role: user
        content:
          request:
            type: screening_check
            jurisdiction: AU
          row:
            id: case-002
            name: Example B
            amount: 25000

    execution:
      evaluators:
        - name: decision-check
          type: code_judge
          script: bun run ./scripts/check-output.ts
          cwd: .
```

## Batch Runner Implementation

The batch runner reads the eval YAML directly and processes all evalcases in one invocation.

### Runner Contract

**Input:** The runner receives the eval file path via `--eval` flag:
```bash
bun run batch-runner.ts --eval ./my-eval.yaml --output ./results.jsonl
```

**Output:** JSONL file where each line is a JSON object with:
```json
{"id": "case-001", "text": "{\"decision\": \"CLEAR\", ...}"}
{"id": "case-002", "text": "{\"decision\": \"REVIEW\", ...}"}
```

The `id` field must match the evalcase `id` for AgentV to route output to the correct evaluator.

### Output with Tool Trajectory Support

To enable `tool_trajectory` evaluation, include `output_messages` with `tool_calls`:

```json
{
  "id": "case-001",
  "text": "{\"decision\": \"CLEAR\", ...}",
  "output_messages": [
    {
      "role": "assistant",
      "tool_calls": [
        {
          "tool": "screening_check",
          "input": { "origin_country": "NZ", "amount": 5000 },
          "output": { "decision": "CLEAR", "reasons": [] }
        }
      ]
    },
    {
      "role": "assistant",
      "content": { "decision": "CLEAR" }
    }
  ]
}
```

AgentV extracts tool calls directly from `output_messages[].tool_calls[]` for `tool_trajectory` evaluators. This is the recommended format for batch runners that make tool calls.

### Example Runner (TypeScript)

```typescript
import fs from 'node:fs/promises';
import { parse } from 'yaml';

type EvalCase = {
  id: string;
  input_messages: Array<{ role: string; content: unknown }>;
};

async function main() {
  const args = process.argv.slice(2);
  const evalPath = getFlag(args, '--eval');
  const outPath = getFlag(args, '--output');

  // Read and parse eval YAML
  const yamlText = await fs.readFile(evalPath, 'utf8');
  const parsed = parse(yamlText);
  const evalcases = parsed.evalcases as EvalCase[];

  // Process each evalcase
  const results: Array<{ id: string; text: string }> = [];
  for (const evalcase of evalcases) {
    const userContent = findUserContent(evalcase.input_messages);
    const decision = processInput(userContent); // Your logic here

    results.push({
      id: evalcase.id,
      text: JSON.stringify({ decision, ...otherFields }),
    });
  }

  // Write JSONL output
  const jsonl = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await fs.writeFile(outPath, jsonl, 'utf8');
}

function getFlag(args: string[], name: string): string {
  const idx = args.indexOf(name);
  return args[idx + 1];
}

function findUserContent(messages: Array<{ role: string; content: unknown }>) {
  return messages.find((m) => m.role === 'user')?.content;
}
```

## Evaluator Implementation

Each evalcase has its own evaluator that validates the output. The evaluator receives the standard code_judge input.

### Evaluator Contract

**Input (stdin):** Standard AgentV code_judge format:
```json
{
  "candidate_answer": "{\"id\":\"case-001\",\"decision\":\"CLEAR\",...}",
  "expected_messages": [{"role": "assistant", "content": {"decision": "CLEAR"}}],
  "input_messages": [...],
  ...
}
```

**Output (stdout):** Standard evaluator result:
```json
{
  "score": 1.0,
  "hits": ["decision matches: CLEAR"],
  "misses": [],
  "reasoning": "Batch runner decision matches expected."
}
```

### Example Evaluator (TypeScript)

```typescript
import fs from 'node:fs';

type EvalInput = {
  candidate_answer?: string;
  expected_messages?: Array<{ role: string; content: unknown }>;
};

function main() {
  const stdin = fs.readFileSync(0, 'utf8');
  const input = JSON.parse(stdin) as EvalInput;

  // Extract expected value from expected_messages
  const expectedDecision = findExpectedDecision(input.expected_messages);

  // Parse candidate answer (output from batch runner)
  let candidateDecision: string | undefined;
  try {
    const parsed = JSON.parse(input.candidate_answer ?? '');
    candidateDecision = parsed.decision;
  } catch {
    candidateDecision = undefined;
  }

  // Compare
  const hits: string[] = [];
  const misses: string[] = [];

  if (expectedDecision === candidateDecision) {
    hits.push(`decision matches: ${expectedDecision}`);
  } else {
    misses.push(`mismatch: expected=${expectedDecision} actual=${candidateDecision}`);
  }

  const score = misses.length === 0 ? 1 : 0;

  process.stdout.write(JSON.stringify({
    score,
    hits,
    misses,
    reasoning: score === 1
      ? 'Batch runner output matches expected.'
      : 'Batch runner output did not match expected.',
  }));
}

function findExpectedDecision(messages?: Array<{ role: string; content: unknown }>) {
  if (!messages) return undefined;
  for (const msg of messages) {
    if (typeof msg.content === 'object' && msg.content !== null) {
      return (msg.content as Record<string, unknown>).decision as string;
    }
  }
  return undefined;
}

main();
```

## Structured Content in expected_messages

For batch evaluation, use structured objects in `expected_messages.content` to define expected output fields:

```yaml
expected_messages:
  - role: assistant
    content:
      decision: CLEAR
      confidence: high
      reasons: []
```

The evaluator then extracts these fields and compares against the parsed candidate output.

## Best Practices

1. **Use unique evalcase IDs** - The batch runner and AgentV use `id` to route outputs
2. **Structured input_messages** - Put structured data in `user.content` for the runner to extract
3. **Structured expected_messages** - Define expected output as objects for easy validation
4. **Deterministic runners** - Batch runners should produce consistent output for testing
5. **Healthcheck support** - Add `--healthcheck` flag for runner validation:
   ```typescript
   if (args.includes('--healthcheck')) {
     console.log('batch-runner: healthy');
     return;
   }
   ```

## Target Configuration

Configure the batch CLI provider in your target:

```yaml
# In agentv-targets.yaml or eval file
targets:
  batch_cli:
    provider: cli
    commandTemplate: bun run ./scripts/batch-runner.ts --eval {EVAL_FILE} --output {OUTPUT_FILE}
    provider_batching: true
```

Key settings:
- `provider: cli` - Use CLI provider
- `provider_batching: true` - Run once for all evalcases
- `{EVAL_FILE}` - Placeholder for eval file path
- `{OUTPUT_FILE}` - Placeholder for JSONL output path
