---
title: Replay Target Workflow Handoff
type: implementation-note
status: draft
updated: 2026-06-14
---

# Replay Target Workflow Handoff

This note captures the implementation boundary and current handoff state for turning the trace-evaluation replay showcase into a reusable replay workflow for expensive live agent and harness targets.

## Product Goal

AgentV should let users run an expensive live target once, record the target response as a strict replay fixture, and later substitute a replay target alias for the live target without changing eval or grader YAML. Replay returns target output only; graders still run fresh so evaluator and grader changes can be tested without re-invoking the live LLM, agent CLI, or harness.

## Scope Boundary

This work owns the replay target database loop:

- record live target responses to keyed JSONL fixtures,
- load replay fixtures through a normal target alias,
- look up records strictly by eval or suite identity, `test_id`, `source_target`, attempt, and variant when present,
- fail before grading on missing or duplicate fixture records,
- preserve target output/messages/tool calls/transcript/usage/cost/duration where available,
- prove replay makes zero live target calls with live-provider environment variables blanked.

The broader normalized trajectory contract remains a separate architecture unit. This replay loop should not invent a competing full trace schema.

## Existing Useful Surface

The showcase already contains a target-substitution pattern under `examples/showcase/trace-evaluation/`:

- `.agentv/targets.yaml` defines `live_coding_agent` and `replay_coding_agent`.
- `fixtures/replay-target-output.jsonl` stores strict snake_case target-output rows.
- `scripts/replay-fixture.ts` looks up rows by `suite`, `test_id`, `source_target`, and `attempt`.
- `scripts/prove-replay.ts` blanks common LLM API env vars and checks that deterministic graders run fresh.

This is a good pattern to promote into reusable core/CLI code rather than leaving it as a showcase-local script.

## Proposed Minimal Contract

A reusable fixture row should stay strict and snake_case at the wire boundary:

```json
{
  "schema_version": "agentv.replay_fixture.v1",
  "suite": "trace-evaluation-showcase",
  "eval_path": "examples/path/example.eval.yaml",
  "test_id": "inspect-and-fix-config",
  "source_target": "live_coding_agent",
  "attempt": 0,
  "variant": null,
  "fixture_id": "codex-live-config-timeout-001",
  "recorded_at": "2026-06-06T12:00:00.000Z",
  "source": { "provider": "codex", "model": "gpt-5" },
  "output": [{ "role": "assistant", "content": "...", "tool_calls": [] }],
  "transcript": null,
  "token_usage": { "input": 912, "output": 246, "cached": 128 },
  "cost_usd": 0.0042,
  "duration_ms": 980
}
```

Only fields that cross the process boundary are snake_case. TypeScript internals should convert to camelCase in one place.

## Candidate Implementation Units

1. Add a small replay fixture module in core or CLI that can:
   - parse JSONL rows,
   - validate `schema_version`, `output`, metrics, and identity fields,
   - build a strict lookup key from suite/eval identity, test id, source target, attempt, and variant,
   - throw actionable missing/duplicate errors before graders run,
   - serialize provider responses into fixture rows.
2. Add a replay target provider or first-class CLI target adapter so users can configure replay in `.agentv/targets.yaml` without copying showcase scripts.
3. Add recording support around live target execution, likely as a CLI/eval option that appends target responses to replay JSONL while keeping replay separate from response cache and grader result cache.
4. Update the showcase to consume the reusable workflow and keep one recorded coding-agent-style fixture as dogfood evidence.
5. Add focused tests for strict lookup, shuffled records, duplicate/missing failures, output/metrics preservation, zero-live replay, and fresh deterministic grader execution.
6. Add docs that explain replay as target substitution, not oracle answers and not cached grader judgments.

## Verification Still Required

Before marking implementation complete, run and record:

- a red run showing the current reusable workflow is missing or requires showcase-local scripts,
- a green run that records a live/mock harness output and replays it through the reusable target with API env blanked,
- a dogfood replay run using either the existing coding-agent showcase fixture or a legal/document-intelligence style recorded fixture,
- focused unit tests and the relevant eval/CLI tests,
- `bun run verify` or a documented narrower verification if full verify is too slow.

## Current Status

This is a handoff checkpoint created before implementation code was ready, so the branch currently contains planning only. The existing showcase and bead comments are the source of truth for acceptance details; next work should begin by extracting the showcase script pattern into reusable core/CLI modules with tests.
