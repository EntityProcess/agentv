---
name: agentv-eval-orchestrator
description: Run AgentV evaluations by orchestrating eval subcommands. Use this skill when asked to run evals, evaluate an agent, test prompt quality using agentv, or run Agent Skills evals.json files.
---

# AgentV Eval Orchestrator

Run AgentV evaluations using the orchestration prompt system.

## Supported Formats

AgentV accepts evaluation files in multiple formats:

- **EVAL YAML** (`.eval.yaml`) — Full-featured AgentV native format
- **JSONL** (`.jsonl`) — One test per line, with optional YAML sidecar
- **Agent Skills evals.json** (`.json`) — Open standard format from Agent Skills

All commands below work with any of these formats.

## Usage

```bash
agentv prompt eval <eval-file>
```

This outputs a complete orchestration prompt with mode-specific instructions and all test IDs. **Follow its instructions exactly.**

The orchestration mode is controlled by the `AGENTV_PROMPT_EVAL_MODE` environment variable:

- **`agent`** (default) — Act as the candidate LLM and judge via two agents (`eval-candidate`, `eval-judge`). No API keys needed.
- **`cli`** — The CLI runs the evaluation end-to-end. Requires API keys.

## How It Works

1. Run `agentv prompt eval <path>` to get orchestration instructions
2. The output tells you exactly what to do based on the current mode
3. Follow the instructions — dispatch agents (agent mode) or run CLI commands (cli mode)
4. Results are written to `.agentv/results/` in JSONL format

## Agent Skills evals.json

When running an `evals.json` file, AgentV automatically:

- Promotes `prompt` → input messages, `expected_output` → reference answer
- Converts `assertions` → llm-judge evaluators
- Resolves `files[]` paths relative to the evals.json directory and copies them into the workspace
- Sets agent mode by default (since evals.json targets agent workflows)

```bash
# Run directly
agentv prompt eval evals.json

# Or convert to YAML first for full feature access
agentv convert evals.json
agentv prompt eval evals.eval.yaml
```

## Benchmark Output

After running evaluations, generate an Agent Skills-compatible `benchmark.json` summary:

```bash
agentv eval evals.json --benchmark-json benchmark.json
```

This produces aggregate pass rates, timing, and token statistics in the Agent Skills benchmark format.

## Converting Formats

To unlock AgentV-specific features (workspace setup, code judges, rubrics, retry policies), convert evals.json to YAML:

```bash
agentv convert evals.json
```

See the [convert command docs](https://agentv.dev/tools/convert/) for details.
