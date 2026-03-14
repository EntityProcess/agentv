# Agent Skills — TypeScript

Demonstrates an [Agent Skills](https://agentskills.io) `evals.json` evaluation where:

- The **input files** (`files[]`) are TypeScript source files (`.ts`) rather than data files
- The **evaluation script** is written in TypeScript and run with [Bun](https://bun.sh) instead of Python

This contrasts with the official `anthropics/skills` examples that use Python scripts exclusively.

## Files

| File | Purpose |
|---|---|
| `evals/evals.json` | Agent Skills eval cases with TypeScript source files in `files[]` |
| `evals/files/formatter.ts` | TypeScript source file given to the agent during evaluation |
| `scripts/check-ts-review.ts` | Bun-based code judge (TypeScript equivalent of a Python eval script) |
| `package.json` | Bun workspace dependency (`@agentv/eval`) |

## Running

### Run via AgentV (evals.json — no API key needed with echo target)

```bash
# From repo root
bun apps/cli/src/cli.ts eval examples/features/agent-skills-ts/evals/evals.json
```

### Test the code judge script standalone

```bash
cd examples/features/agent-skills-ts
bun install

cat << 'EOF' | bun run scripts/check-ts-review.ts
{
  "question": "Review formatter.ts for type safety",
  "criteria": "Identifies any type, var, and missing return types",
  "answer": "The code uses 'any' type throughout and 'var' instead of 'const'. Explicit type annotations and return types are missing.",
  "reference_answer": "",
  "guideline_files": [],
  "input_files": [],
  "input": [],
  "expected_output": [],
  "output": []
}
EOF
```

Expected output:
```json
{"score":1,"hits":["Addresses 'any' type usage","Recommends const/let over var","Recommends explicit type annotations"],"misses":[]}
```

### Run EVAL.yaml with TypeScript code judge (mock provider — no API key)

```bash
# From the examples/features directory
bun ../../apps/cli/src/cli.ts eval agent-skills-ts/evals/dataset.eval.yaml
```

The TypeScript code judge (`ts-quality-check`) runs automatically. Test 1 will pass
(score 1.0) since the mock response contains the key TypeScript concepts. The LLM
judges require a real judge target — substitute `--target <your-target>` for live runs.

### Convert to EVAL.yaml and add the TypeScript code judge

```bash
# Convert evals.json → EVAL.yaml
bun apps/cli/src/cli.ts convert examples/features/agent-skills-ts/evals/evals.json
```

Then add the code judge to a test:

```yaml
assert:
  - type: llm-judge            # natural-language assertions from evals.json
  - name: ts-quality
    type: code-judge
    command: ["bun", "run", "../scripts/check-ts-review.ts"]
```

## Why TypeScript instead of Python?

All official `anthropics/skills` evaluation scripts use Python (`uv run script.py`).
AgentV is TypeScript/Bun-native, so evaluation scripts can be written in TypeScript and
run with `bun run`, requiring no Python installation.

| Concern | Python approach | TypeScript/Bun approach |
|---|---|---|
| Runtime | `python3` / `uv` | `bun` |
| Dependencies | `requirements.txt` | `package.json` |
| Type safety | Optional (mypy) | Built-in |
| Shared types with eval harness | Manual | `@agentv/eval` SDK |
| Shebang | `#!/usr/bin/env python3` | `#!/usr/bin/env bun` |

The `@agentv/eval` SDK (`defineCodeJudge`, `defineAssertion`) handles stdin/stdout
boilerplate and Zod validation automatically, keeping evaluation scripts lean.
