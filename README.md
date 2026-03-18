# AgentV

**CLI-first AI agent evaluation. No server. No signup. No overhead.**

AgentV evaluates your agents locally with multi-objective scoring (correctness, latency, cost, safety) from YAML specifications. Deterministic code graders + customizable LLM graders, all version-controlled in Git.

## Installation

### All Agents Plugin Manager

**1. Add AgentV marketplace source:**
```bash
npx allagents plugin marketplace add EntityProcess/agentv
```

**2. Ask Claude to set up AgentV in your current repository**
Example prompt:
```text
Set up AgentV in this repo.
```

The `agentv-onboarding` skill bootstraps setup automatically:
- verifies `agentv` CLI availability
- installs the CLI if needed
- runs `agentv init`
- verifies setup artifacts

### CLI-Only Setup (Fallback)

If you are not using Claude plugins, use the CLI directly.

**1. Install:**
```bash
bun install -g agentv
```

Or with npm:
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

    assertions:
      - name: math_check
        type: code-grader
        command: ./validators/check_math.py
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
| **Setup** | `bun install -g agentv` | Cloud account + API key | Cloud account + API key | Cloud account + API key |
| **Server** | None (local) | Managed cloud | Managed cloud | Managed cloud |
| **Privacy** | All local | Cloud-hosted | Cloud-hosted | Cloud-hosted |
| **CLI-first** | ✓ | ✗ | Limited | Limited |
| **CI/CD ready** | ✓ | Requires API calls | Requires API calls | Requires API calls |
| **Version control** | ✓ (YAML in Git) | ✗ | ✗ | ✗ |
| **Evaluators** | Code + LLM + Custom | LLM only | LLM + Code | LLM only |

**Best for:** Developers who want evaluation in their workflow, not a separate dashboard. Teams prioritizing privacy and reproducibility.

## Features

- **Multi-objective scoring**: Correctness, latency, cost, safety in one run
- **Multiple evaluator types**: Code validators, LLM graders, custom Python/TypeScript
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

Version bump:

```bash
bun run release          # patch bump
bun run release minor
bun run release major
```

Canary rollout (recommended):

```bash
bun run publish:next         # publish current version to npm `next`
bun run promote:latest       # promote same version to npm `latest`
bun run tag:next 2.18.0      # point npm `next` to an explicit version
bun run promote:latest 2.18.0 # point npm `latest` to an explicit version
```

Legacy prerelease flow (still available):

```bash
bun run release:next         # bump/increment `-next.N`
bun run release:next major   # start new major prerelease line
```

## Core Concepts

**Evaluation files** (`.yaml` or `.jsonl`) define test cases with expected outcomes. **Targets** specify which agent/provider to evaluate. **Graders** (code or LLM) score results. **Results** are written as JSONL/YAML for analysis and comparison.

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
  target: azure-llm
assertions:
  - name: correctness
    type: llm-grader
    prompt: ./graders/correctness.md
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
agentv eval --target azure-llm evals/**/*.yaml

# Run specific test
agentv eval --test-id case-123 evals/my-eval.yaml

# Dry-run with mock provider
agentv eval --dry-run evals/my-eval.yaml
```

See `agentv eval --help` for all options: workers, timeouts, output formats, trace dumping, and more.

#### Output Formats

Write results to different formats using the `-o` flag (format auto-detected from extension):

```bash
# JSONL (default streaming format)
agentv eval evals/my-eval.yaml -o results.jsonl

# Self-contained HTML dashboard (opens in any browser, no server needed)
agentv eval evals/my-eval.yaml -o report.html

# Multiple formats simultaneously
agentv eval evals/my-eval.yaml -o results.jsonl -o report.html

# JUnit XML for CI/CD integration
agentv eval evals/my-eval.yaml -o results.xml
```

The HTML report auto-refreshes every 2 seconds during a live run, then locks once the run completes.

You can also convert an existing JSONL results file to HTML after the fact:

```bash
agentv convert results.jsonl -o report.html
```

#### Timeouts

AgentV does not apply a default top-level evaluation timeout. If you want one, set it explicitly
with `--agent-timeout`, or set `execution.agentTimeoutMs` in your AgentV config to make it the
default for your local runs.

This top-level timeout is separate from provider- or tool-level timeouts. For example, an upstream
agent or tool call may still time out even when AgentV's own top-level timeout is unset.

### Create Custom Evaluators

Write code graders in Python or TypeScript:

```python
# validators/check_answer.py
import json, sys
data = json.load(sys.stdin)
answer = data.get("answer", "")

assertions = []

if "42" in answer:
    assertions.append({"text": "Answer contains correct value (42)", "passed": True})
else:
    assertions.append({"text": "Answer does not contain expected value (42)", "passed": False})

passed = sum(1 for a in assertions if a["passed"])
score = 1.0 if passed == len(assertions) else 0.0

print(json.dumps({
    "score": score,
    "assertions": assertions,
}))
```

Reference evaluators in your eval file:

```yaml
assertions:
  - name: my_validator
    type: code-grader
    command: ./validators/check_answer.py
```

For complete templates, examples, and evaluator patterns, see: [custom-evaluators](https://agentv.dev/evaluators/custom-evaluators/)

### TypeScript SDK

#### Custom Assertions with `defineAssertion()`

Create custom assertion types in TypeScript using `@agentv/eval`:

```typescript
// .agentv/assertions/word-count.ts
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer }) => {
  const wordCount = answer.trim().split(/\s+/).length;
  return {
    pass: wordCount >= 3,
    reasoning: `Output has ${wordCount} words`,
  };
});
```

Files in `.agentv/assertions/` are auto-discovered by filename — use directly in YAML:

```yaml
assertions:
  - type: word-count    # matches word-count.ts
  - type: contains
    value: "Hello"
```

See the [sdk-custom-assertion example](examples/features/sdk-custom-assertion).

#### Programmatic API with `evaluate()`

Use AgentV as a library — no YAML needed:

```typescript
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello',
      assertions: [{ type: 'contains', value: 'Hello' }],
    },
  ],
});

console.log(`${summary.passed}/${summary.total} passed`);
```

Auto-discovers `default` target from `.agentv/targets.yaml` and `.env` credentials. See the [sdk-programmatic-api example](examples/features/sdk-programmatic-api).

#### Typed Configuration with `defineConfig()`

Create `agentv.config.ts` at your project root for typed, validated configuration:

```typescript
import { defineConfig } from '@agentv/core';

export default defineConfig({
  execution: { workers: 5, maxRetries: 2 },
  output: { format: 'jsonl', dir: './results' },
  limits: { maxCostUsd: 10.0 },
});
```

See the [sdk-config-file example](examples/features/sdk-config-file).

#### Scaffold Commands

Bootstrap new assertions and eval files:

```bash
agentv create assertion sentiment   # → .agentv/assertions/sentiment.ts
agentv create eval my-eval          # → evals/my-eval.eval.yaml + .cases.jsonl
```

### Compare Evaluation Results

Compare a combined results file across all targets (N-way matrix):

```bash
agentv compare results.jsonl
```

```
Score Matrix

  Test ID          gemini-3-flash-preview  gpt-4.1  gpt-5-mini
  ───────────────  ──────────────────────  ───────  ──────────
  code-generation                    0.70     0.80        0.75
  greeting                           0.90     0.85        0.95
  summarization                      0.85     0.90        0.80

Pairwise Summary:
  gemini-3-flash-preview → gpt-4.1:     1 win, 0 losses, 2 ties  (Δ +0.033)
  gemini-3-flash-preview → gpt-5-mini:  0 wins, 0 losses, 3 ties  (Δ +0.017)
  gpt-4.1 → gpt-5-mini:                 0 wins, 0 losses, 3 ties  (Δ -0.017)
```

Designate a baseline for CI regression gating, or compare two specific targets:

```bash
agentv compare results.jsonl --baseline gpt-4.1                          # exit 1 on regression
agentv compare results.jsonl --baseline gpt-4.1 --candidate gpt-5-mini  # pairwise
agentv compare before.jsonl after.jsonl                                  # two-file pairwise
```

## Targets Configuration

Define execution targets in `.agentv/targets.yaml` to decouple evals from providers:

```yaml
targets:
  - name: azure-llm
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: ${{ AZURE_DEPLOYMENT_NAME }}

  - name: vscode_dev
    provider: vscode
    grader_target: azure-llm

  - name: local_agent
    provider: cli
    command: 'python agent.py --prompt-file {PROMPT_FILE} --output {OUTPUT_FILE}'
    grader_target: azure-llm
```

Supports: `azure`, `anthropic`, `gemini`, `codex`, `copilot`, `pi-coding-agent`, `claude`, `vscode`, `vscode-insiders`, `cli`, and `mock`.

Workspace templates are configured at eval-level under `workspace.template` (not per-target `workspace_template`).

Use `${{ VARIABLE_NAME }}` syntax to reference your `.env` file. See `.agentv/targets.yaml` after `agentv init` for detailed examples and all provider-specific fields.

## Evaluation Features

### Code Graders

Write validators in any language (Python, TypeScript, Node, etc.):

```bash
# Input: stdin JSON with question, criteria, answer
# Output: stdout JSON with score (0-1), hits, misses, reasoning
```

For complete examples and patterns, see:
- [custom-evaluators](https://agentv.dev/evaluators/custom-evaluators/)
- [code-grader-sdk example](examples/features/code-grader-sdk)

### Deterministic Assertions

Built-in assertion types for common text-matching patterns — no LLM grader or code_grader needed:

| Type | Value | Behavior |
|------|-------|----------|
| `contains` | `string` | Pass if output includes the substring |
| `contains_any` | `string[]` | Pass if output includes ANY of the strings |
| `contains_all` | `string[]` | Pass if output includes ALL of the strings |
| `icontains` | `string` | Case-insensitive `contains` |
| `icontains_any` | `string[]` | Case-insensitive `contains_any` |
| `icontains_all` | `string[]` | Case-insensitive `contains_all` |
| `starts_with` | `string` | Pass if output starts with value (trimmed) |
| `ends_with` | `string` | Pass if output ends with value (trimmed) |
| `regex` | `string` | Pass if output matches regex (optional `flags: "i"`) |
| `equals` | `string` | Pass if output exactly equals value (trimmed) |
| `is_json` | — | Pass if output is valid JSON |

All assertions support `weight`, `required`, and `negate` flags. Use `negate: true` to invert (no `not_` prefix needed).

```yaml
assertions:
  # Case-insensitive matching for natural language variation
  - type: icontains-any
    value: ["missing rule code", "need rule code", "provide rule code"]
    required: true

  # Multiple required terms
  - type: icontains-all
    value: ["country code", "rule codes"]

  # Case-insensitive regex
  - type: regex
    value: "[a-z]+@[a-z]+\\.[a-z]+"
    flags: "i"
```

See the [assert-extended example](examples/features/assert-extended) for complete patterns.

### Target Configuration: `grader_target`

Agent provider targets (`codex`, `copilot`, `claude`, `vscode`) **must** specify `grader_target` (also accepts `judge_target` for backward compatibility) when using `llm_grader` or `rubrics` evaluators. Without it, AgentV errors at startup — agent providers cannot return structured JSON for grading.

```yaml
targets:
  # Agent target — requires grader_target for LLM-based evaluation
  - name: codex_local
    provider: codex
    grader_target: azure-llm  # Required: LLM provider for grading

  # LLM target — no grader_target needed (grades itself)
  - name: azure-llm
    provider: azure
```

### Agentic Eval Patterns

When agents respond via tool calls instead of text, use `tool_trajectory` instead of text assertions:

- **Agent takes workspace actions** (creates files, runs commands) → `tool_trajectory` evaluator
- **Agent responds in text** (answers questions, asks for info) → `contains`/`icontains_any`/`llm_grader`
- **Agent does both** → `composite` evaluator combining both

### LLM Graders

Create markdown grader files with evaluation criteria and scoring guidelines:

```yaml
assertions:
  - name: semantic_check
    type: llm-grader
    prompt: ./graders/correctness.md
```

Your grader prompt file defines criteria and scoring guidelines.

### Rubric-Based Evaluation

Define structured criteria directly in your test:

```yaml
tests:
  - id: quicksort-explain
    criteria: Explain how quicksort works

    input: Explain quicksort algorithm

    assertions:
      - type: rubrics
        criteria:
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
  - name: azure-llm
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

## Troubleshooting

### `EACCES` permission error on global install (npm)

If you see `EACCES: permission denied` when running `npm install -g agentv`, switch to bun (recommended) or configure npm to use a user-owned directory:

**Option 1 (recommended): Use bun instead**
```bash
bun install -g agentv
```

**Option 2: Fix npm permissions**
```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global --location=user
```

Then add the directory to your PATH. For bash (`~/.bashrc`) or zsh (`~/.zshrc`):

```bash
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

After this, `npm install -g` will work without `sudo`.

## Contributing

See [AGENTS.md](AGENTS.md) for development guidelines, design principles, and quality assurance workflow.

## License

MIT License - see [LICENSE](LICENSE) for details.
