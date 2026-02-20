# Basic Features Example

Demonstrates core AgentV schema features with minimal setup.

## What This Shows

- Core schema: `input`, `expected_output`
- File references for content
- Conversation threading with multiple messages
- Array content format (text + file references)
- Multiple evaluators per test case

## Running

```bash
# From repository root
bun agentv eval examples/features/basic/evals/dataset.yaml

# With specific target
bun agentv eval examples/features/basic/evals/dataset.yaml --target default
```

## Key Files

- `evals/dataset.yaml` - Main evaluation file with test cases
- `files/*.js` - Sample code files referenced in test cases
