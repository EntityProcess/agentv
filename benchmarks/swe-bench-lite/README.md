# SWE-bench Lite Benchmark

Run [SWE-bench Lite](https://www.swebench.com/) (300 instances) through AgentV with richer metrics than the original leaderboard.

## Quick Start

### 1. Setup

Download the dataset from HuggingFace and generate EVAL.yaml files:

```bash
cd benchmarks/swe-bench-lite
bun run setup.ts
```

This creates `evals/*.EVAL.yaml` — one per SWE-bench instance. Files are gitignored (generated from HuggingFace source of truth).

### 2. Run Evaluations

```bash
# Run all instances against a target
bun apps/cli/src/cli.ts eval benchmarks/swe-bench-lite/evals/ --target claude

# Run a single instance
bun apps/cli/src/cli.ts eval benchmarks/swe-bench-lite/evals/django__django-15180.EVAL.yaml --target claude

# Run with cost tracking
bun apps/cli/src/cli.ts eval benchmarks/swe-bench-lite/evals/ --target claude --output results/claude-opus-4.6.json
```

### 3. Submit Results

Results are submitted via GitHub PR. Each result file goes in `results/<model-slug>.json`.

**Steps:**
1. Fork the [agentv repo](https://github.com/EntityProcess/agentv)
2. Run the benchmark (see above)
3. Add your result JSON to `benchmarks/swe-bench-lite/results/<your-model>.json`
4. Open a PR — CI validates the JSON schema automatically

### Result JSON Format

```json
{
  "model": "Claude Opus 4.6",
  "provider": "anthropic",
  "model_type": "proprietary",
  "date": "2026-04-08",
  "agent": "mini-swe-agent-agentv",
  "agent_version": "1.0.0",
  "dataset": "swe-bench-lite",
  "total_instances": 300,
  "resolved_instances": 218,
  "resolution_rate": 0.727,
  "avg_cost_usd": 0.55,
  "avg_cost_per_fix_usd": 0.76,
  "avg_duration_ms": 45000,
  "avg_tool_calls": 8.2,
  "per_instance": [
    {
      "instance_id": "django__django-15180",
      "resolved": true,
      "cost_usd": 0.42,
      "duration_ms": 32000,
      "tool_calls": 6
    }
  ]
}
```

See `result.schema.json` for the full validation schema.

### Leaderboard

Results are displayed on [agentv.dev/leaderboard](https://agentv.dev/leaderboard) with:
- **Multi-dimensional ranking** — not just pass/fail, but cost, latency, tool efficiency
- **Cost-normalized scoring** — $/Fix metric shows best value per dollar
- **Pareto frontier** — visual chart of score vs cost tradeoffs
- **Filterable** — by model type, provider, date

## Dataset

- **Source:** [HuggingFace SWE-bench/SWE-bench_Lite](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite)
- **Split:** test (300 instances)
- **Docker images:** `swebench/sweb.eval.x86_64.*` from DockerHub

## Architecture

```
setup.ts → downloads from HuggingFace → generates evals/*.EVAL.yaml
                                              ↓
                                    agentv eval ./evals/
                                              ↓
                              Docker container per instance
                              (image from SWE-bench registry)
                                              ↓
                              graders/swe-bench-grader.ts
                              (runs inside container)
                                              ↓
                                    results/*.json
                                              ↓
                                 agentv.dev/leaderboard
```
