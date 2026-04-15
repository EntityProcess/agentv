# Deterministic Graders

Demonstrates how a single, parameterised `code_grader` script can replace a family of built-in assertion graders (contains, regex, JSON validation, etc.).

## Why a Code Grader?

AgentV's design philosophy keeps the core minimal. Instead of adding `contains`, `regex`, `is-json` as built-in grader types, you write a small code grader and drive it with YAML `config`:

```yaml
graders:
  - name: has-keyword
    type: code-grader
    command: ["bun", "run", "../graders/assertions.ts"]
    config:
      type: contains
      value: "hello"
```

## Supported Assertion Types

| `type` | `value` | Description |
|---|---|---|
| `contains` | substring | Case-sensitive substring match |
| `icontains` | substring | Case-insensitive substring match |
| `equals` | string | Exact string equality |
| `regex` | pattern | Regular expression test |
| `starts-with` | prefix | String prefix match |
| `is-json` | *(unused)* | Validates that the response is parseable JSON |

Set `negated: true` in config to invert any assertion.

## Files

- `graders/assertions.ts` — Parameterised code grader using `defineCodeGrader` from `@agentv/eval`
- `evals/dataset.eval.yaml` — Example tests covering every assertion type

## Setup

From the repository root:

```bash
bun install
bun run build
```

## Run

```bash
# From examples/features
bun agentv eval deterministic-graders/evals/dataset.eval.yaml --target <your-target>
```

## Standalone Test

Pipe a JSON payload directly to the grader:

```bash
cd examples/features/deterministic-graders
cat <<'EOF' | bun run graders/assertions.ts
{
  "question": "Say hello",
  "criteria": "Response contains hello",
  "expected_output": [],
  "answer": "Hello world!",
  "input_files": [],
  "input": [],
  "config": { "type": "icontains", "value": "hello" }
}
EOF
```
