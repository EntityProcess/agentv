# Offline LLM-as-Judge Benchmark

A public, offline workflow for benchmarking **judge quality itself** against a human-labeled export.

It uses existing AgentV primitives:
- a `cli` replay target to return the frozen agent output from each sample,
- three `llm-judge` evaluators (each can use a different low-cost target),
- a `composite` threshold aggregator for majority vote,
- `agentv compare` for A/B judge-setup comparison,
- and a small post-processing script that scores the judge panel against human ground truth.

## Files

```text
offline-judge-benchmark/
├── .agentv/targets.yaml                  # Replay target + three illustrative low-cost judge targets
├── README.md
├── evals/
│   ├── setup-a.eval.yaml                 # Judge setup A
│   └── setup-b.eval.yaml                 # Judge setup B
├── fixtures/
│   └── labeled-judge-export.jsonl        # Safe sample export contract (no production data)
├── prompts/
│   ├── judge-pass-fail-v1.md             # Setup A prompt
│   └── judge-pass-fail-v2.md             # Setup B prompt
└── scripts/
    ├── replay-fixture-output.ts          # Replays frozen agent output from each sample
    └── score-judge-benchmark.ts          # Scores majority vote against human labels
```

## Export contract for offline datasets

Each JSONL row should contain:

```json
{
  "id": "unique-sample-id",
  "criteria": "PASS/FAIL rubric the judges should apply",
  "input": "Task/context plus a <<<AGENT_OUTPUT ... >>>AGENT_OUTPUT block",
  "expected_output": {
    "label": "pass",
    "rationale": "Why the expert labeled it this way"
  }
}
```

### Required semantics

- `input` must include the **task/context** and the frozen **agent output**.
- Wrap the frozen output in `<<<AGENT_OUTPUT` / `>>>AGENT_OUTPUT` so the replay target can return it exactly.
- `criteria` is what the judge models see.
- `expected_output.label` is the **human ground truth** used only in post-processing.
- Keep real production content out of git; export privately and run the same workflow on that file locally.

## Configure the bundled judge targets

The example ships with three illustrative low-cost judges:
- `judge_gpt_5_mini` via Azure using `${AZURE_DEPLOYMENT_NAME}`
- `judge_claude_haiku` via OpenRouter model `anthropic/claude-haiku-4.5`
- `judge_gemini_flash` via OpenRouter model `google/gemini-3-flash-preview`

Edit `.agentv/targets.yaml` if your local environment uses different deployment names or model IDs.

## No-API-key smoke test

The repository includes synthetic raw-result fixtures so you can verify the post-processing and A/B compare flow without making any LLM calls:

```bash
bun examples/showcase/offline-judge-benchmark/scripts/score-judge-benchmark.ts \
  --results examples/showcase/offline-judge-benchmark/fixtures/setup-a.raw.jsonl \
  --dataset examples/showcase/offline-judge-benchmark/fixtures/labeled-judge-export.jsonl \
  --label judge-setup-a \
  > /tmp/judge-setup-a.scored.jsonl

bun examples/showcase/offline-judge-benchmark/scripts/score-judge-benchmark.ts \
  --results examples/showcase/offline-judge-benchmark/fixtures/setup-b.raw.jsonl \
  --dataset examples/showcase/offline-judge-benchmark/fixtures/labeled-judge-export.jsonl \
  --label judge-setup-b \
  > /tmp/judge-setup-b.scored.jsonl

bun apps/cli/src/cli.ts compare /tmp/judge-setup-a.scored.jsonl /tmp/judge-setup-b.scored.jsonl
```

## Run one judge setup

From the repository root:

```bash
# Setup A: run the three-model judge panel over the labeled export
bun apps/cli/src/cli.ts eval \
  examples/showcase/offline-judge-benchmark/evals/setup-a.eval.yaml \
  --output .agentv/results/offline-judge-setup-a.raw.jsonl

# Convert raw panel results into benchmark-scored JSONL (1 = matched human label, 0 = missed)
bun examples/showcase/offline-judge-benchmark/scripts/score-judge-benchmark.ts \
  --results .agentv/results/offline-judge-setup-a.raw.jsonl \
  --dataset examples/showcase/offline-judge-benchmark/fixtures/labeled-judge-export.jsonl \
  --label judge-setup-a \
  > .agentv/results/offline-judge-setup-a.scored.jsonl

# Optional: summarize benchmark accuracy and per-target stats
bun examples/features/benchmark-tooling/scripts/benchmark-report.ts \
  .agentv/results/offline-judge-setup-a.scored.jsonl
```

The scorer prints a summary JSON object to stderr with ensemble accuracy and per-judge accuracy.

## A/B compare judge setups on the same dataset

```bash
# Run both setups against the same labeled export
bun apps/cli/src/cli.ts eval examples/showcase/offline-judge-benchmark/evals/setup-a.eval.yaml \
  --output .agentv/results/offline-judge-setup-a.raw.jsonl
bun apps/cli/src/cli.ts eval examples/showcase/offline-judge-benchmark/evals/setup-b.eval.yaml \
  --output .agentv/results/offline-judge-setup-b.raw.jsonl

# Score both runs against human labels
bun examples/showcase/offline-judge-benchmark/scripts/score-judge-benchmark.ts \
  --results .agentv/results/offline-judge-setup-a.raw.jsonl \
  --dataset examples/showcase/offline-judge-benchmark/fixtures/labeled-judge-export.jsonl \
  --label judge-setup-a \
  > .agentv/results/offline-judge-setup-a.scored.jsonl
bun examples/showcase/offline-judge-benchmark/scripts/score-judge-benchmark.ts \
  --results .agentv/results/offline-judge-setup-b.raw.jsonl \
  --dataset examples/showcase/offline-judge-benchmark/fixtures/labeled-judge-export.jsonl \
  --label judge-setup-b \
  > .agentv/results/offline-judge-setup-b.scored.jsonl

# Head-to-head comparison with AgentV's built-in compare flow
bun apps/cli/src/cli.ts compare \
  .agentv/results/offline-judge-setup-a.scored.jsonl \
  .agentv/results/offline-judge-setup-b.scored.jsonl
```

Because the scored files use one record per `test_id` with a numeric `score`, they plug directly into `agentv compare`, `benchmark-report.ts`, `significance-test.ts`, and any other JSONL-based reporting flow.

## What changes between setups?

- Swap judge targets (`target:` per `llm-judge`) to compare different judge-model mixes.
- Swap the prompt file to compare judge instructions/policies.
- Keep the labeled export constant so the comparison stays paired and fair.

## Why this stays lightweight

This workflow avoids a new benchmark subsystem in core. The reusable pieces are already in AgentV:
- `llm-judge` for individual judge models,
- `composite` for majority-vote panels,
- JSONL outputs for offline post-processing,
- `compare` for A/B analysis.

The only glue is a replay target and a small scoring script.
