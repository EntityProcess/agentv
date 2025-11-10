# AgentEvo

AgentEvo continuously improves (or simply evaluates) AI agent prompts and context. It supports:

- **External Mode**: AgentEvo provides a versioned prompt artifact to an external agent (e.g. Copilot, Claude Code, proprietary agent) and invokes it.
- **Internal Mode**: AgentEvo uses its built-in lightweight multi-step executor and registered local tools.
- **Evaluation-Only**: Run scoring against a YAML panel without automatic optimization (manual human iteration supported).

Both modes work locally via CLI or HTTP API.

## Core Features

- Versioned prompt/context artifact (single JSON file).
- YAML evaluation panel (tasks, expected outputs, metric targets).
- Multi-objective scoring (correctness, latency, cost, tool efficiency, robustness, optional safety).
- Candidate generation → safe promotion → instant rollback (when optimization is desired).
- Local tool registry (CLI/API wrappers) for Internal Mode.
- Pluggable adapters for external agents.
- Evaluation-only workflow for manual prompt editing.

## Modes

| Mode      | Who Executes Steps & Tools             | Invocation Flag   | Typical Use                      |
| --------- | -------------------------------------- | ----------------- | -------------------------------- |
| External  | External agent (API/CLI/SDK)           | `--mode external` | Integrate with existing platform |
| Internal  | AgentEvo built-in executor             | `--mode internal` | Local dev / offline evaluation   |
| Eval-only | External or internal (no optimization) | `eval` command    | Manual iteration / benchmarking  |

Invoke via:

- CLI: `agentevo run --mode internal ...`
- API: `POST /v1/run` with JSON body including `"mode":"external"`

## Quick Start

```bash
npm i -g agentevo
agentevo init
agentevo run --mode internal --task "Summarize vector databases"
agentevo optimize --artifact ./artifacts/current.json --panel ./eval/panel.yaml
agentevo promote --candidate ./artifacts/candidate.json
```

## Evaluation-Only Examples

```bash
# Internal execution of all panel tasks
agentevo eval --mode internal \
  --artifact ./artifacts/current.json \
  --panel ./eval/panel.yaml \
  --report ./reports/eval-v13.json

# External agent execution
agentevo eval --mode external \
  --agent-type claude-code \
  --agent-endpoint http://localhost:5000 \
  --artifact ./artifacts/current.json \
  --panel ./eval/panel.yaml \
  --report ./reports/eval-v13-external.json

# Diff two evaluation reports
agentevo diff report ./reports/eval-v13.json ./reports/manual-edit-v13a.json
```

## Minimal Prompt Artifact

```json
{
  "version": "v13",
  "system": { "text": "You are a research assistant. Follow safety and efficiency rules." },
  "planner": { "text": "Task: {{task}}\\nProduce 3-6 atomic steps." },
  "tool_caller": {
    "text": "Step: {{step}}\\nSelect ONE tool JSON {\"tool\":...,\"args\":...,\"rationale\":\"<40w\"}"
  },
  "summarizer": { "text": "Steps:\\n{{steps}}\\nSummarize in <=180 words with sources [n]." },
  "bullets": {
    "safety": ["Never expose PII"],
    "efficiency": ["Avoid duplicate search queries", "Retry a failing tool at most 2 times"]
  },
  "model_config": { "temperature": 0.2 },
  "hash": "sha256:abc123"
}
```

## YAML Evaluation Panel (Example)

```yaml
tasks:
  - id: t1
    task: "Explain embeddings"
    expected: "High-level overview with dimensions & cosine similarity"
    metrics:
      correctness: exact
      latency_target_ms: 1500
      max_tool_calls: 5
  - id: t2
    task: "List 3 recent LLM efficiency papers"
    expected: "Three titles + year"
    metrics:
      correctness: semantic
      sources_required: 3
scoring:
  weights:
    correctness: 0.45
    toolEfficiency: 0.15
    robustness: 0.15
    cost: 0.15
    latency: 0.10
thresholds:
  promote_min_improvement: 0.02
  correctness_min: 0.85
```

## Optimization Loop

1. Execute tasks (external or internal).
2. Collect traces tagged with `artifact_version`.
3. Score tasks on panel.
4. Generate candidate (prompt mutations, bullet adjustments, temperature tweaks).
5. Re-score; promote if thresholds met.
6. Rollback on regression.

## Evaluation-Only Loop (Manual)

1. `agentevo eval` baseline.
2. Manually edit `current.json`.
3. Re-run `agentevo eval`.
4. Compare with `agentevo diff report`.
5. If human-approved improvement → copy / tag version, optionally `agentevo promote`.

## CLI Commands

| Command                   | Purpose                                |
| ------------------------- | -------------------------------------- |
| `agentevo init`           | Scaffold artifact & panel              |
| `agentevo run`            | Execute a task (internal/external)     |
| `agentevo eval`           | Score panel tasks without optimization |
| `agentevo optimize`       | Generate candidate artifact            |
| `agentevo promote`        | Make candidate current                 |
| `agentevo rollback`       | Revert to prior version                |
| `agentevo tool add`       | Register local tool                    |
| `agentevo panel validate` | Validate YAML panel                    |
| `agentevo diff report`    | Compare evaluation reports             |

## Local Tools

Register:

```bash
agentevo tool add --name search --cmd "python scripts/search.py --query '{{input}}'"
```

Use:

```bash
agentevo run --mode internal --task "Find recent RAG benchmarks"
```

## API (Local)

| Endpoint               | Method | Description                        |
| ---------------------- | ------ | ---------------------------------- |
| `/v1/run`              | POST   | Execute a task (internal/external) |
| `/v1/eval`             | POST   | Evaluation-only execution          |
| `/v1/artifact/current` | GET    | Fetch active artifact              |
| `/v1/optimize`         | POST   | Trigger optimization cycle         |
| `/v1/rollback`         | POST   | Revert artifact version            |

## Metrics (Defaults)

- correctness
- latency
- cost
- toolEfficiency
- robustness

Composite:

```
Score = 0.45*correctness + 0.15*toolEfficiency + 0.15*robustness + 0.15*cost + 0.10*latency
```

## Safety Gates (Promotion)

Blocked if:

- Correctness < threshold
- Safety violation
- Cost increase > 15%
- Latency P95 > cap

## Rollback

```bash
agentevo rollback --to v12
```

## Exit Codes

| Code | Meaning                 |
| ---- | ----------------------- |
| 0    | Success                 |
| 10   | No improvement          |
| 20   | Safety regression       |
| 30   | Invalid artifact/panel  |
| 40   | Trace ingestion failure |
| 50   | Hash / integrity error  |

## Structured Logging

```
{"ts":"...","artifact":"v13","stage":"planner","latency_ms":122}
{"ts":"...","artifact":"v13","stage":"tool","tool":"search","latency_ms":410}
{"ts":"...","artifact":"v13","final":{"correctness":0.9,"score":0.86}}
```

## FAQ

- **Can I just evaluate?** Yes - use `agentevo eval`.
- **Do I need external infra?** No - Internal Mode runs locally.
- **Can I use my existing agent?** Yes - External Mode supplies the prompt artifact.
- **Manual tuning?** Edit artifact → `agentevo eval` → `diff report` → promote manually.
