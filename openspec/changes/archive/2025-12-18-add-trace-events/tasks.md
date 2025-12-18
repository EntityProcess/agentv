# Tasks: Add Trace Events to Evaluation

> **Note to implementing agent:** These tasks are guidelines, not rigid requirements. Use your judgment - if you find a simpler approach, discover the codebase already has patterns that differ from what's specified, or realize some tasks are unnecessary, adapt accordingly. The specs define *what* to achieve; the tasks suggest *how*, but the codebase is the source of truth for implementation patterns.

---

## Phase 1: Foundation (sequential - required by all other phases)

### 1.1 Core types and interfaces
- [ ] Add `TraceEvent` interface to `packages/core/src/evaluation/trace.ts` (new file)
- [ ] Add `TraceSummary` interface to `packages/core/src/evaluation/trace.ts`
- [ ] Add `computeTraceSummary(trace: TraceEvent[]): TraceSummary` function
- [ ] Add `ToolTrajectoryEvaluatorConfig` interface
- [ ] Add `ExpectedToolCall` interface for expected_messages tool_calls
- [ ] Extend `ProviderResponse` type with optional `trace` and `traceRef` fields
- [ ] Export new types from `packages/core/src/index.ts`

**Unit tests:**
- [ ] Test `computeTraceSummary` with various trace inputs
- [ ] Test `computeTraceSummary` with empty trace
- [ ] Test `computeTraceSummary` sorts toolNames alphabetically

### 1.2 Schema validation
- [ ] Add `tool_trajectory` to evaluator type union in Zod schema
- [ ] Add validation for `mode` enum (`any_order`, `in_order`, `exact`)
- [ ] Add validation for `minimums` (Record<string, number>)
- [ ] Add validation for `expected` (Array<{ tool: string }>)
- [ ] Add `tool_calls` schema for expected_messages assistant messages
- [ ] Add validation for `tool_calls` entries (`tool` required, `input`/`output` optional)

**Unit tests:**
- [ ] Test schema validation for tool_trajectory config - valid configs
- [ ] Test schema validation for tool_trajectory config - invalid mode rejected
- [ ] Test schema validation for expected_messages with tool_calls - valid
- [ ] Test schema validation for expected_messages with tool_calls - missing tool name rejected

### 1.3 Evaluator context plumbing
- [ ] Extend evaluator context interface to include `candidate_trace` and `candidate_trace_summary`
- [ ] Update orchestrator to compute TraceSummary when trace is present
- [ ] Update orchestrator to load trace from `traceRef` file when provided
- [ ] Pass trace data to evaluators in context

---

## Phase 2: Parallel Implementation (after Phase 1)

> These tasks can be executed by parallel subagents after Phase 1 completes.

### Subagent A: tool_trajectory evaluator

**Implementation:**
- [ ] Create `packages/core/src/evaluation/evaluators/tool-trajectory.ts`
- [ ] Implement `mode: any_order` with `minimums` validation
- [ ] Implement `mode: in_order` with `expected` sequence validation
- [ ] Implement `mode: exact` with `expected` sequence validation
- [ ] Handle missing trace case (return score 0 with "No trace available" miss)
- [ ] Return standard evaluator result shape: `{ score, hits, misses, reasoning: null }`

**Unit tests:**
- [ ] Test `tool_trajectory` evaluator - minimums pass case
- [ ] Test `tool_trajectory` evaluator - minimums fail case
- [ ] Test `tool_trajectory` evaluator - multiple minimums partial scoring
- [ ] Test `tool_trajectory` evaluator - in_order pass case
- [ ] Test `tool_trajectory` evaluator - in_order fail (wrong order)
- [ ] Test `tool_trajectory` evaluator - exact pass case
- [ ] Test `tool_trajectory` evaluator - exact fail (extra tools)
- [ ] Test `tool_trajectory` evaluator - no trace available case

### Subagent B: expected_messages tool_calls validation

**Implementation:**
- [ ] Extend expected_messages validation to extract `tool_calls` from assistant messages
- [ ] Implement sequential matching: compare expected tool_calls against trace tool_call events
- [ ] Match tool name exactly
- [ ] Match input via deep equality (only if input specified in expected)
- [ ] Match output via deep equality (only if output specified in expected)
- [ ] Calculate partial score: matched / expected
- [ ] Handle missing trace case (return score 0 with "No trace available" miss)
- [ ] Generate appropriate hits/misses messages

**Unit tests:**
- [ ] Test expected_messages tool_calls validation - full match pass
- [ ] Test expected_messages tool_calls validation - tool name mismatch
- [ ] Test expected_messages tool_calls validation - input mismatch
- [ ] Test expected_messages tool_calls validation - input not specified (matches any)
- [ ] Test expected_messages tool_calls validation - partial match scoring
- [ ] Test expected_messages tool_calls validation - fewer actual than expected
- [ ] Test expected_messages tool_calls validation - no trace available

### Subagent C: CLI output

**Implementation:**
- [ ] Add `--dump-traces` flag to write trace files to `.agentv/traces/`
- [ ] Add `--include-trace` flag to include full trace inline in result output
- [ ] Include `trace_summary` in JSONL output by default (when present)
- [ ] Update result writers to handle new fields

**Unit tests:**
- [ ] Test `--dump-traces` writes trace files to `.agentv/traces/`
- [ ] Test `--dump-traces` filename format includes eval_id and attempt
- [ ] Test `--include-trace` includes full trace in output
- [ ] Test `trace_summary` appears in JSONL output by default
- [ ] Test `trace_summary` omitted when no trace available

---

## Phase 3: Integration (after Phase 2)

### 3.1 Integration tests
- [ ] Create integration test matching example.md end-to-end scenario
- [ ] Verify trace flows from provider response through to evaluation result
- [ ] Test Pattern A (expected_messages with tool_calls) end-to-end
- [ ] Test Pattern B (tool_trajectory evaluator) end-to-end
- [ ] Test combined patterns end-to-end

### 3.2 Validation + release readiness
- [ ] Run `bun run build` - ensure no compile errors
- [ ] Run `bun run typecheck` - ensure type safety
- [ ] Run `bun run lint` - ensure code style
- [ ] Run `bun test` - ensure all tests pass

---

## Out of scope (deferred)
- Provider-specific trace capture (Azure, Anthropic, Gemini, VSCode, Codex)
- LLM judge trace template variables
