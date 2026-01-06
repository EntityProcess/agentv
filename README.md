# AgentV

**CLI-first AI agent evaluation. No server. No signup. No overhead.**

AgentV evaluates your agents locally with multi-objective scoring (correctness, latency, cost, safety) from YAML specifications. Deterministic code judges + customizable LLM judges, all version-controlled in Git.

## Installation

**1. Install:**
```bash
npm install -g agentv
```

**2. Initialize your workspace:**
```bash
agentv init
```

**3. Create an eval** (`./evals/example.yaml`):
```yaml
description: Math problem solving evaluation
execution:
  target: default

evalcases:
  - id: addition
    expected_outcome: Correctly calculates 15 + 27 = 42

    input_messages:
      - role: user
        content: What is 15 + 27?

    expected_messages:
      - role: assistant
        content: "42"

    execution:
      evaluators:
        - name: math_check
          type: code_judge
          script: ./validators/check_math.py
```

**4. Run the eval:**
```bash
agentv eval ./evals/example.yaml
```

Results appear in `.agentv/results/eval_<timestamp>.jsonl` with scores, reasoning, and execution traces.

Learn more in the [examples/](examples/README.md) directory. For a detailed comparison with other frameworks, see [docs/COMPARISON.md](docs/COMPARISON.md).

## Why AgentV?

| Feature | AgentV | [LangWatch](https://github.com/langwatch/langwatch) | [LangSmith](https://github.com/langchain-ai/langsmith-sdk) | [LangFuse](https://github.com/langfuse/langfuse) |
|---------|--------|-----------|-----------|----------|
| **Setup** | `npm install` | Cloud account + API key | Cloud account + API key | Cloud account + API key |
| **Server** | None (local) | Managed cloud | Managed cloud | Managed cloud |
| **Privacy** | All local | Cloud-hosted | Cloud-hosted | Cloud-hosted |
| **CLI-first** | ✓ | ✗ | Limited | Limited |
| **CI/CD ready** | ✓ | Requires API calls | Requires API calls | Requires API calls |
| **Version control** | ✓ (YAML in Git) | ✗ | ✗ | ✗ |
| **Evaluators** | Code + LLM + Custom | LLM only | LLM + Code | LLM only |

**Best for:** Developers who want evaluation in their workflow, not a separate dashboard. Teams prioritizing privacy and reproducibility.

## Features

- **Multi-objective scoring**: Correctness, latency, cost, safety in one run
- **Multiple evaluator types**: Code validators, LLM judges, custom Python/TypeScript
- **Built-in targets**: VS Code Copilot, Codex CLI, Pi Coding Agent, Azure OpenAI, local CLI agents
- **Structured evaluation**: Rubric-based grading with weights and requirements
- **Batch evaluation**: Run hundreds of test cases in parallel
- **Export**: JSON, JSONL, YAML formats
- **Compare results**: Compute deltas between evaluation runs for A/B testing

## Development

Contributing to AgentV? Clone and set up the repository:

```bash
git clone https://github.com/EntityProcess/agentv.git
cd agentv

# Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# Install dependencies and build
bun install && bun run build

# Run tests
bun test
```

See [AGENTS.md](AGENTS.md) for development guidelines and design principles.

## Core Concepts

**Evaluation files** (`.yaml`) define test cases with expected outcomes. **Targets** specify which agent/provider to evaluate. **Judges** (code or LLM) score results. **Results** are written as JSONL/YAML for analysis and comparison.

## Usage

### Running Evaluations

```bash
# Validate evals
agentv validate evals/my-eval.yaml

# Run an eval with default target (from eval file or targets.yaml)
agentv eval evals/my-eval.yaml

# Override target
agentv eval --target azure_base evals/**/*.yaml

# Run specific eval case
agentv eval --eval-id case-123 evals/my-eval.yaml

# Dry-run with mock provider
agentv eval --dry-run evals/my-eval.yaml
```

See `agentv eval --help` for all options: workers, timeouts, output formats, trace dumping, and more.

### Create Custom Evaluators

Write code judges in Python or TypeScript:

```python
# validators/check_answer.py
import json, sys
data = json.load(sys.stdin)
candidate_answer = data.get("candidate_answer", "")

hits = []
misses = []

if "42" in candidate_answer:
    hits.append("Answer contains correct value (42)")
else:
    misses.append("Answer does not contain expected value (42)")

score = 1.0 if hits else 0.0

print(json.dumps({
    "score": score,
    "hits": hits,
    "misses": misses,
    "reasoning": f"Passed {len(hits)} check(s)"
}))
```

Reference evaluators in your eval file:

```yaml
execution:
  evaluators:
    - name: my_validator
      type: code_judge
      script: ./validators/check_answer.py
```

For complete templates, examples, and evaluator patterns, see: [custom-evaluators.md](apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/custom-evaluators.md)

### Compare Evaluation Results

Run two evaluations and compare them:

```bash
agentv eval evals/my-eval.yaml --out before.jsonl
# ... make changes to your agent ...
agentv eval evals/my-eval.yaml --out after.jsonl
agentv compare before.jsonl after.jsonl --threshold 0.1
```

Output shows wins, losses, ties, and mean delta to identify improvements.

## Targets Configuration

Define execution targets in `.agentv/targets.yaml` to decouple evals from providers:

```yaml
targets:
  - name: azure_base
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: ${{ AZURE_DEPLOYMENT_NAME }}

  - name: vscode_dev
    provider: vscode
    workspace_template: ${{ WORKSPACE_PATH }}
    judge_target: azure_base

  - name: local_agent
    provider: cli
    command_template: 'python agent.py --prompt {PROMPT}'
    judge_target: azure_base
```

Supports: `azure`, `anthropic`, `gemini`, `codex`, `pi-coding-agent`, `claude-code`, `vscode`, `vscode-insiders`, `cli`, and `mock`.

Use `${{ VARIABLE_NAME }}` syntax to reference your `.env` file. See `.agentv/targets.yaml` after `agentv init` for detailed examples and all provider-specific fields.

## Evaluation Features

### Code Judges

Write validators in any language (Python, TypeScript, Node, etc.):

```bash
# Input: stdin JSON with question, expected_outcome, candidate_answer
# Output: stdout JSON with score (0-1), hits, misses, reasoning
```

For complete examples and patterns, see:
- [custom-evaluators skill](apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/custom-evaluators.md)
- [code-judge-sdk example](examples/features/code-judge-sdk)

### LLM Judges

Create markdown judge files with evaluation criteria and scoring guidelines:

```yaml
execution:
  evaluators:
    - name: semantic_check
      type: llm_judge
      prompt: ./judges/correctness.md
```

Your judge prompt file defines criteria and scoring guidelines.

### Rubric-Based Evaluation

Define structured criteria directly in your eval case:

```yaml
evalcases:
  - id: quicksort-explain
    expected_outcome: Explain how quicksort works

    input_messages:
      - role: user
        content: Explain quicksort algorithm

    rubrics:
      - Mentions divide-and-conquer approach
      - Explains partition step
      - States time complexity
```

Scoring: `(satisfied weights) / (total weights)` → verdicts: `pass` (≥0.8), `borderline` (≥0.6), `fail`

Auto-generate rubrics from expected outcomes:
```bash
agentv generate rubrics evals/my-eval.yaml
```

See [rubric-evaluator skill](apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/rubric-evaluator.md) for detailed patterns.

## Advanced Configuration

### Retry Behavior

Configure automatic retry with exponential backoff:

```yaml
targets:
  - name: azure_base
    provider: azure
    max_retries: 5
    retry_initial_delay_ms: 2000
    retry_max_delay_ms: 120000
    retry_backoff_factor: 2
    retry_status_codes: [500, 408, 429, 502, 503, 504]
```

Automatically retries on rate limits, transient 5xx errors, and network failures with jitter.

## Documentation & Learning

**Getting Started:**
- Run `agentv init` to set up your first evaluation workspace
- Check [examples/README.md](examples/README.md) for demos (math, code generation, tool use)
- AI agents: Ask Claude Code to `/agentv-eval-builder` to create and iterate on evals

**Detailed Guides:**
- [Evaluation format and structure](apps/cli/src/templates/.claude/skills/agentv-eval-builder/SKILL.md)
- [Custom evaluators](apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/custom-evaluators.md)
- [Structured data evaluation](apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/structured-data-evaluators.md)

**Reference:**
- Monorepo structure: `packages/core/` (engine), `packages/eval/` (evaluation logic), `apps/cli/` (commands)

## Contributing

See [AGENTS.md](AGENTS.md) for development guidelines, design principles, and quality assurance workflow.

## License

MIT License - see [LICENSE](LICENSE) for details.
