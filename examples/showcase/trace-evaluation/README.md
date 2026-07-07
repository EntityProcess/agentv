# Replay-First Trace Evaluation Showcase

This showcase demonstrates trace evaluation as target substitution:

- `live_coding_agent` is the live coding-agent target shape a team would record from.
- `replay_coding_agent` is a normal replay target alias that returns recorded provider output from JSONL.
- The eval YAML and graders stay the same when switching targets.
- Replay fixtures return target output only; AgentV runs graders fresh on each replay run.

## Files

```text
trace-evaluation/
├── .agentv/providers.yaml
├── evals/
│   ├── coding-agent-replay.eval.yaml
│   └── transcript-import.eval.yaml
├── fixtures/
│   ├── replay-target-output.jsonl
│   ├── imported-codex-transcript.jsonl
│   └── raw/codex-sessions/2026/06/06/rollout-2026-06-06T12-00-00-00000000-0000-4000-8000-000000000001.jsonl
├── graders/
│   ├── recovery-check.ts
│   └── replay-proof.ts
└── scripts/
    └── prove-replay.ts
```

## Replay Run

From the repository root:

```bash
bun apps/cli/src/cli.ts eval \
  examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml \
  --provider replay_coding_agent \
  --output /tmp/agentv-trace-showcase-replay-run
```

The replay target looks up records by `suite`, `eval_path` when present, `test_id`,
`source_target`, `attempt`, and `variant` when configured. Missing or duplicate
records fail before grading.

Replay can also read `agentv.trace.v1` artifacts by using
`execution_traces` or normalized AgentV transcript JSONL by using `transcripts`
instead of `fixtures` on the replay target. Configure exactly one source field:

```yaml
targets:
  - name: replay_from_execution_traces
    provider: replay
    execution_traces: ../fixtures/execution-traces.jsonl
    suite: trace-evaluation-showcase
    source_target: live_coding_agent
```

Execution trace replay requires the matched artifact to contain full captured assistant
output. Metadata-only trace sidecars fail before grading rather than replaying
an empty answer.

Transcript replay uses `agentv.transcript.v1` rows from `agentv import` and
matches by `test_id` plus `source_target`. A missing or mismatched `test_id`
fails before grading so a grader does not silently score the wrong trajectory.

## Proof Run

```bash
bun examples/showcase/trace-evaluation/scripts/prove-replay.ts
```

The proof script runs the replay eval with common LLM API keys blanked. It then verifies:

- the result target is `replay_coding_agent`,
- the proof script grader ran once per test,
- replayed target metrics are preserved,
- deterministic graders produced fresh scores for `trajectory:*`, `execution-metrics`, `recovery-check`, and `replay-proof`.

To record a new fixture from a live target, run the same eval with the live
target and `--record-replay`:

```bash
bun apps/cli/src/cli.ts eval \
  examples/showcase/trace-evaluation/evals/coding-agent-replay.eval.yaml \
  --provider live_coding_agent \
  --record-replay examples/showcase/trace-evaluation/fixtures/replay-target-output.jsonl \
  --output /tmp/agentv-trace-showcase-live-run
```

## Transcript Import Fixture

The imported fixture was produced through the Codex import command with
`--test-id` set to the eval case id. The row `source.session_id` still
preserves the raw session provenance:

```bash
bun apps/cli/src/cli.ts import codex \
  --sessions-dir examples/showcase/trace-evaluation/fixtures/raw/codex-sessions \
  --date 2026-06-06 \
  --session-id 00000000-0000-4000-8000-000000000001 \
  --test-id imported-codex-config-fix \
  --output examples/showcase/trace-evaluation/fixtures/imported-codex-transcript.jsonl
```

It can be graded without a live target:

```bash
bun apps/cli/src/cli.ts eval \
  examples/showcase/trace-evaluation/evals/transcript-import.eval.yaml \
  --transcript examples/showcase/trace-evaluation/fixtures/imported-codex-transcript.jsonl \
  --output /tmp/agentv-trace-showcase-transcript-run
```
