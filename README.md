# AgentV

A TypeScript-based AI agent evaluation and optimization framework using YAML specifications to score task completion. Built for modern development workflows with first-class support for VS Code Copilot, OpenAI Codex CLI and Azure OpenAI.

## Installation and Setup

### Installation for End Users

This is the recommended method for users who want to use `agentv` as a command-line tool.

1. Install via npm:

```bash
# Install globally
npm install -g agentv

# Or use npx to run without installing
npx agentv --help
```

2. Verify the installation:

```bash
agentv --help
```

### Local Development Setup

Follow these steps if you want to contribute to the `agentv` project itself. This workflow uses Bun workspaces for fast, efficient dependency management.

1. Clone the repository and navigate into it:

```bash
git clone https://github.com/EntityProcess/agentv.git
cd agentv
```

2. Install dependencies:

```bash
# Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash  # macOS/Linux
# or
powershell -c "irm bun.sh/install.ps1 | iex"  # Windows

# Install all workspace dependencies
bun install
```

3. Build the project:

```bash
bun run build
```

4. Run tests:

```bash
bun test
```

You are now ready to start development. The monorepo contains:

- `packages/core/` - Core evaluation engine
- `apps/cli/` - Command-line interface

### Environment Setup

1. Initialize your workspace:
   - Run `agentv init` at the root of your repository
   - This command automatically sets up the `.agentv/` directory structure and configuration files

2. Configure environment variables:
   - The init command creates a `.env.template` file in your project root
   - Copy `.env.template` to `.env` and fill in your API keys, endpoints, and other configuration values
   - Update the environment variable names in `.agentv/targets.yaml` to match those defined in your `.env` file

## Quick Start

You can use the following examples as a starting point.
- [Simple Example](docs/examples/simple/README.md): A minimal working example to help you get started fast.
- [Showcase](docs/examples/showcase/README.md): A collection of advanced use cases and real-world agent evaluation scenarios.

### Validating Eval Files

Validate your eval and targets files before running them:

```bash
# Validate a single file
agentv validate evals/my-eval.yaml

# Validate multiple files
agentv validate evals/eval1.yaml evals/eval2.yaml

# Validate entire directory (recursively finds all YAML files)
agentv validate evals/
```

### Running Evals

Run eval (target auto-selected from eval file or CLI override):

```bash
# If your eval.yaml contains "target: azure_base", it will be used automatically
agentv eval "path/to/eval.yaml"

# Override the eval file's target with CLI flag
agentv eval --target vscode_projectx "path/to/eval.yaml"

# Run multiple evals via glob
agentv eval "path/to/evals/**/*.yaml"
```

Run a specific eval case with custom targets path:

```bash
agentv eval --target vscode_projectx --targets "path/to/targets.yaml" --eval-id "my-eval-case" "path/to/eval.yaml"
```

### Command Line Options

- `eval_paths...`: Path(s) or glob(s) to eval YAML files (required; e.g., `evals/**/*.yaml`)
- `--target TARGET`: Execution target name from targets.yaml (overrides target specified in eval file)
- `--targets TARGETS`: Path to targets.yaml file (default: ./.agentv/targets.yaml)
- `--eval-id EVAL_ID`: Run only the eval case with this specific ID
- `--out OUTPUT_FILE`: Output file path (default: .agentv/results/eval_<timestamp>.jsonl)
- `--output-format FORMAT`: Output format: 'jsonl' or 'yaml' (default: jsonl)
- `--dry-run`: Run with mock model for testing
- `--agent-timeout SECONDS`: Timeout in seconds for agent response polling (default: 120)
- `--max-retries COUNT`: Maximum number of retries for timeout cases (default: 2)
- `--cache`: Enable caching of LLM responses (default: disabled)
- `--dump-prompts`: Save all prompts to `.agentv/prompts/` directory
- `--dump-traces`: Write trace files to `.agentv/traces/` directory
- `--include-trace`: Include full trace in result output (verbose)
- `--workers COUNT`: Parallel workers for eval cases (default: 3; target `workers` setting used when provided)
- `--verbose`: Verbose output

### Target Selection Priority

The CLI determines which execution target to use with the following precedence:

1. CLI flag override: `--target my_target` (when provided and not 'default')
2. Eval file specification: `target: my_target` key in the .eval.yaml file
3. Default fallback: Uses the 'default' target (original behavior)

This allows eval files to specify their preferred target while still allowing command-line overrides for flexibility, and maintains backward compatibility with existing workflows.

Output goes to `.agentv/results/eval_<timestamp>.jsonl` (or `.yaml`) unless `--out` is provided.

### Tips for VS Code Copilot Evals

**Workspace Switching:** The runner automatically switches to the target workspace when running evals. Make sure you're not actively using another VS Code instance, as this could cause prompts to be injected into the wrong workspace.

**Recommended Models:** Use Claude Sonnet 4.5 or Grok Code Fast 1 for best results, as these models are more consistent in following instruction chains.

## Targets and Environment Variables

Execution targets in `.agentv/targets.yaml` decouple evals from providers/settings and provide flexible environment variable mapping.

### Target Configuration Structure

Each target specifies:

- `name`: Unique identifier for the target
- `provider`: The model provider (`azure`, `anthropic`, `gemini`, `codex`, `vscode`, `vscode-insiders`, `cli`, or `mock`)
- Provider-specific configuration fields at the top level (no `settings` wrapper needed)
- Optional fields: `judge_target`, `workers`, `provider_batching`

### Examples

**Azure OpenAI targets:**

```yaml
- name: azure_base
  provider: azure
  endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
  api_key: ${{ AZURE_OPENAI_API_KEY }}
  model: ${{ AZURE_DEPLOYMENT_NAME }}
  version: ${{ AZURE_OPENAI_API_VERSION }}  # Optional: defaults to 2024-12-01-preview
```

Note: Environment variables are referenced using `${{ VARIABLE_NAME }}` syntax. The actual values are resolved from your `.env` file at runtime.

**VS Code targets:**

```yaml
- name: vscode_projectx
  provider: vscode
  workspace_template: ${{ PROJECTX_WORKSPACE_PATH }}
  provider_batching: false
  judge_target: azure_base

- name: vscode_insiders_projectx
  provider: vscode-insiders
  workspace_template: ${{ PROJECTX_WORKSPACE_PATH }}
  provider_batching: false
  judge_target: azure_base
```

**CLI targets (template-based):**

```yaml
- name: local_cli
  provider: cli
  judge_target: azure_base
  command_template: 'uv run ./my_agent.py --prompt {PROMPT} {FILES}'
  files_format: '--file {path}'
  cwd: ${{ CLI_EVALS_DIR }}       # optional working directory
  timeout_seconds: 30             # optional per-command timeout
  healthcheck:
    type: command                 # or http
    command_template: uv run ./my_agent.py --healthcheck
```

**Supported placeholders in CLI commands:**
- `{PROMPT}` - The rendered prompt text (shell-escaped)
- `{FILES}` - Expands to multiple file arguments using `files_format` template
- `{GUIDELINES}` - Guidelines content
- `{EVAL_ID}` - Current eval case ID
- `{ATTEMPT}` - Retry attempt number
- `{OUTPUT_FILE}` - Path to output file (for agents that write responses to disk)

**Codex CLI targets:**

```yaml
- name: codex_cli
  provider: codex
  judge_target: azure_base
  executable: ${{ CODEX_CLI_PATH }}     # defaults to `codex` if omitted
  args:                                 # optional CLI arguments
    - --profile
    - ${{ CODEX_PROFILE }}
    - --model
    - ${{ CODEX_MODEL }}
  timeout_seconds: 180
  cwd: ${{ CODEX_WORKSPACE_DIR }}
  log_format: json                      # 'summary' or 'json'
```

Codex targets require the standalone `codex` CLI and a configured profile (via `codex configure`) so credentials are stored in `~/.codex/config` (or whatever path the CLI already uses). AgentV mirrors all guideline and attachment files into a fresh scratch workspace, so the `file://` preread links remain valid even when the CLI runs outside your repo tree.
Confirm the CLI works by running `codex exec --json --profile <name> "ping"` (or any supported dry run) before starting an eval. This prints JSONL events; seeing `item.completed` messages indicates the CLI is healthy.

## Writing Custom Evaluators

### Code Evaluator I/O Contract

Code evaluators receive input via stdin and write output to stdout as JSON.

**Input Format (via stdin):**
```json
{
  "question": "string describing the task/question",
  "expected_outcome": "expected outcome description",
  "reference_answer": "gold standard answer (optional)",
  "candidate_answer": "generated code/text from the agent",
  "guideline_files": ["path/to/guideline1.md", "path/to/guideline2.md"],
  "input_files": ["path/to/data.json", "path/to/config.yaml"],
  "input_messages": [{"role": "user", "content": "..."}]
}
```

**Output Format (to stdout):**
```json
{
  "score": 0.85,
  "hits": ["list of successful checks"],
  "misses": ["list of failed checks"],
  "reasoning": "explanation of the score"
}
```

**Key Points:**
- Evaluators receive **full context** but should select only relevant fields
- Most evaluators only need `candidate_answer` field - ignore the rest to avoid false positives
- Complex evaluators can use `question`, `reference_answer`, or `guideline_paths` for context-aware validation
- Score range: `0.0` to `1.0` (float)
- `hits` and `misses` are optional but recommended for debugging

### Code Evaluator Script Template

```python
#!/usr/bin/env python3
import json
import sys

def evaluate(input_data):
    # Extract only the fields you need
    candidate_answer = input_data.get("candidate_answer", "")
    
    # Your validation logic here
    score = 0.0  # to 1.0
    hits = ["successful check 1", "successful check 2"]
    misses = ["failed check 1"]
    reasoning = "Explanation of score"
    
    return {
        "score": score,
        "hits": hits,
        "misses": misses,
        "reasoning": reasoning
    }

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        result = evaluate(input_data)
        print(json.dumps(result, indent=2))
    except Exception as e:
        error_result = {
            "score": 0.0,
            "hits": [],
            "misses": [f"Evaluator error: {str(e)}"],
            "reasoning": f"Evaluator error: {str(e)}"
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)
```

### LLM Judge Template Structure

```markdown
# Judge Name

Evaluation criteria and guidelines...

## Scoring Guidelines
0.9-1.0: Excellent
0.7-0.8: Good
...

## Output Format
{
  "score": 0.85,
  "passed": true,
  "reasoning": "..."
}
```

## Rubric-Based Evaluation

AgentV supports structured evaluation through rubrics - lists of criteria that define what makes a good response. Rubrics are checked by an LLM judge and scored based on weights and requirements.

### Basic Usage

Define rubrics inline using simple strings:

```yaml
- id: example-1
  expected_outcome: Explain quicksort algorithm
  rubrics:
    - Mentions divide-and-conquer approach
    - Explains the partition step
    - States time complexity correctly
```

Or use detailed objects for fine-grained control:

```yaml
rubrics:
  - id: structure
    description: Has clear headings and organization
    weight: 1.0
    required: true
  - id: examples
    description: Includes practical examples
    weight: 0.5
    required: false
```

### Generate Rubrics

Automatically generate rubrics from `expected_outcome` fields:

```bash
# Generate rubrics for all eval cases without rubrics
agentv generate rubrics evals/my-eval.yaml

# Use a specific LLM target for generation
agentv generate rubrics evals/my-eval.yaml --target openai:gpt-4o
```

### Scoring and Verdicts

- **Score**: (sum of satisfied weights) / (total weights)
- **Verdicts**:
  - `pass`: Score ≥ 0.8 and all required rubrics met
  - `borderline`: Score ≥ 0.6 and all required rubrics met
  - `fail`: Score < 0.6 or any required rubric failed

For complete examples and detailed patterns, see [examples/features/evals/rubric/](examples/features/evals/rubric/).

## Advanced Configuration

### Retry Configuration

AgentV supports automatic retry with exponential backoff for handling rate limiting (HTTP 429) and transient errors. All retry configuration fields are optional and work with Azure, Anthropic, and Gemini providers.

**Available retry fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_retries` | number | 3 | Maximum number of retry attempts |
| `retry_initial_delay_ms` | number | 1000 | Initial delay in milliseconds before first retry |
| `retry_max_delay_ms` | number | 60000 | Maximum delay cap in milliseconds |
| `retry_backoff_factor` | number | 2 | Exponential backoff multiplier |
| `retry_status_codes` | number[] | [500, 408, 429, 502, 503, 504] | HTTP status codes to retry |

**Example configuration:**

```yaml
targets:
  - name: azure_base
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: gpt-4
    version: ${{ AZURE_OPENAI_API_VERSION }}                # Optional: API version (defaults to 2024-12-01-preview)
    max_retries: 5                                          # Maximum retry attempts
    retry_initial_delay_ms: 2000                            # Initial delay before first retry
    retry_max_delay_ms: 120000                              # Maximum delay cap
    retry_backoff_factor: 2                                 # Exponential backoff multiplier
    retry_status_codes: [500, 408, 429, 502, 503, 504]     # HTTP status codes to retry
```

**Retry behavior:**
- Exponential backoff with jitter (0.75-1.25x) to avoid thundering herd
- Automatically retries on HTTP 429 (rate limiting), 5xx errors, and network failures
- Respects abort signals for cancellation
- If no retry config is specified, uses sensible defaults

## Related Projects

- [subagent](https://github.com/EntityProcess/subagent) - VS Code Copilot programmatic interface
- [ai-sdk](https://github.com/vercel/ai) - Vercel AI SDK
- [Agentic Context Engineering (ACE)](https://github.com/ax-llm/ax/blob/main/docs/ACE.md)

## License

MIT License - see [LICENSE](LICENSE) for details.
