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

**3. Configure environment variables:**
- The init command creates a `.env.example` file in your project root
- Copy `.env.example` to `.env` and fill in your API keys, endpoints, and other configuration values
- Update the environment variable names in `.agentv/targets.yaml` to match those defined in your `.env` file

**4. Create an eval** (`./evals/example.yaml`):
```yaml
description: Math problem solving evaluation
execution:
  target: default

tests:
  - id: addition
    criteria: Correctly calculates 15 + 27 = 42

    input: What is 15 + 27?

    expected_output: "42"

    execution:
      evaluators:
        - name: math_check
          type: code_judge
          script: ./validators/check_math.py
```

**5. Run the eval:**
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

### Releasing

Stable release:

```bash
bun run release          # patch bump
bun run release minor
bun run release major
bun run publish          # publish to npm `latest`
```

Prerelease (`next`) channel:

```bash
bun run release:next         # bump/increment `-next.N`
bun run release:next major   # start new major prerelease line
bun run publish:next         # publish to npm `next`
```

## Core Concepts

**Evaluation files** (`.yaml` or `.jsonl`) define test cases with expected outcomes. **Targets** specify which agent/provider to evaluate. **Judges** (code or LLM) score results. **Results** are written as JSONL/YAML for analysis and comparison.

### JSONL Format Support

For large-scale evaluations, AgentV supports JSONL (JSON Lines) format as an alternative to YAML:

```jsonl
{"id": "test-1", "criteria": "Calculates correctly", "input": "What is 2+2?"}
{"id": "test-2", "criteria": "Provides explanation", "input": "Explain variables"}
```

Optional sidecar YAML metadata file (`dataset.eval.yaml` alongside `dataset.jsonl`):
```yaml
description: Math evaluation dataset
dataset: math-tests
execution:
  target: azure_base
evaluator: llm_judge
```

Benefits: Streaming-friendly, Git-friendly diffs, programmatic generation, industry standard (DeepEval, LangWatch, Hugging Face).

## Usage

### Running Evaluations

```bash
# Validate evals
agentv validate evals/my-eval.yaml

# Run an eval with default target (from eval file or targets.yaml)
agentv eval evals/my-eval.yaml

# Override target
agentv eval --target azure_base evals/**/*.yaml

# Run specific test
agentv eval --test-id case-123 evals/my-eval.yaml

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

For complete templates, examples, and evaluator patterns, see: [custom-evaluators](https://agentv.dev/evaluators/custom-evaluators/)

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

Supports: `azure`, `anthropic`, `gemini`, `codex`, `copilot`, `pi-coding-agent`, `claude`, `vscode`, `vscode-insiders`, `cli`, and `mock`.

Use `${{ VARIABLE_NAME }}` syntax to reference your `.env` file. See `.agentv/targets.yaml` after `agentv init` for detailed examples and all provider-specific fields.

## Evaluation Features

### Code Judges

Write validators in any language (Python, TypeScript, Node, etc.):

```bash
# Input: stdin JSON with question, criteria, candidate_answer
# Output: stdout JSON with score (0-1), hits, misses, reasoning
```

For complete examples and patterns, see:
- [custom-evaluators](https://agentv.dev/evaluators/custom-evaluators/)
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

Define structured criteria directly in your test:

```yaml
tests:
  - id: quicksort-explain
    criteria: Explain how quicksort works

    input: Explain quicksort algorithm

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

See [rubric evaluator](https://agentv.dev/evaluation/rubrics/) for detailed patterns.

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
- [Evaluation format and structure](https://agentv.dev/evaluation/eval-files/)
- [Custom evaluators](https://agentv.dev/evaluators/custom-evaluators/)
- [Rubric evaluator](https://agentv.dev/evaluation/rubrics/)
- [Composite evaluator](https://agentv.dev/evaluators/composite/)
- [Tool trajectory evaluator](https://agentv.dev/evaluators/tool-trajectory/)
- [Structured data evaluators](https://agentv.dev/evaluators/structured-data/)
- [Batch CLI evaluation](https://agentv.dev/evaluation/batch-cli/)
- [Compare results](https://agentv.dev/tools/compare/)
- [Example evaluations](https://agentv.dev/evaluation/examples/)

**Reference:**
- Monorepo structure: `packages/core/` (engine), `packages/eval/` (evaluation logic), `apps/cli/` (commands)

## Contributing

See [AGENTS.md](AGENTS.md) for development guidelines, design principles, and quality assurance workflow.

## License

MIT License - see [LICENSE](LICENSE) for details.
