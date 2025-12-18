# Tasks: Add Trace Events to Evaluation

## 1. Spec & schema updates
- [ ] Update `openspec/changes/add-trace-events/specs/evaluation/spec.md` with trace capture + trace-aware evaluator requirements
- [ ] Update `openspec/changes/add-trace-events/specs/yaml-schema/spec.md` with new evaluator types and config shapes
- [ ] Update `openspec/changes/add-trace-events/specs/eval-cli/spec.md` with trace output/debug options

## 2. Core types + result plumbing
- [ ] Add `TraceEvent` and `TraceSummary` types to the core evaluation result model
- [ ] Extend provider response types to carry `trace` and/or `trace_ref`
- [ ] Propagate trace into orchestrator results and evaluator context

## 3. Trace evaluators
- [ ] Implement `tool_trajectory` evaluator (deterministic) with `minimums`, `expected`, and `mode` support
- [ ] Add unit tests for `tool_trajectory` evaluator

## 4. LLM judge trace visibility (opt-in)
- [ ] Add template variables for `candidate_trace_summary` (and full trace when enabled)
- [ ] Ensure LLM judge prompts remain backward compatible when trace is absent

## 5. CLI output and debugging
- [ ] Add CLI flag(s) to include full trace in result output
- [ ] Add CLI flag(s) to dump per-case trace artifacts to `.agentv/traces/` (similar to `--dump-prompts`)
- [ ] Update output writers and JSONL/YAML schemas accordingly

## 6. Validation + release readiness
- [ ] Run `openspec validate add-trace-events --strict`
- [ ] Add/adjust tests; run `bun run build`, `bun run typecheck`, `bun run lint`, `bun test`
