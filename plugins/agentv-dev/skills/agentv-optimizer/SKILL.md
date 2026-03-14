---
name: agentv-optimizer
description: "Run the full agent-evaluation lifecycle: discover → run → grade → compare → analyze → review → optimize → re-run. Use when asked to evaluate an agent, optimize prompts against evals, run EVAL.yaml or evals.json evaluations, compare agent outputs, analyze eval results, or improve agent performance. Supports workspace evaluation with real repos, multi-provider targets, multi-turn conversations, code judges, tool trajectory scoring, and workspace file change tracking."
---

# AgentV Agent-Evaluation Lifecycle

## Overview

An agent **is** its prompts. This skill orchestrates the complete agent-evaluation lifecycle — from running evaluations through grading, comparison, analysis, human review, optimization, and re-running — in a single invocation. It dispatches specialized agents at each phase and produces structured artifacts throughout.

The workflow is structured into eight phases: **Discovery → Run → Grade → Compare → Analyze → Review → Optimize → Re-run**. Users can enter at any phase (e.g., "I already have results, just analyze them") and skip optional phases (e.g., comparison when there's only one run, or human review in CI mode).

### How this differs from skill-creator

| | AgentV Lifecycle Skill (this) | Anthropic skill-creator |
|--|-------------------------------|------------------------|
| **Primary input** | EVAL.yaml (workspace evals) | evals.json (skill evals) |
| **Also accepts** | evals.json, JSONL datasets | — |
| **Environment** | Clone repos, setup/teardown scripts, real project contexts | Isolated single-prompt |
| **Targets** | Multiple providers (Claude, GPT, Copilot, Gemini, custom CLI) | With-skill vs without-skill |
| **Evaluators** | Code judges, tool trajectory, LLM judge, deterministic | LLM judge, deterministic |
| **Conversations** | Multi-turn with conversation_id tracking | Single-turn |
| **Workspace** | File change tracking via workspace diffs | Text output only |
| **Modes** | Agent mode (no API keys) + CLI mode (end-to-end) | CLI only |

For users migrating from skill-creator, see `references/migrating-from-skill-creator.md`.

## Input Variables

- `eval-path`: Path or glob pattern to the AgentV evaluation file(s) — EVAL.yaml, evals.json, or JSONL
- `optimization-log-path` (optional): Path where optimization progress should be logged
- `entry-phase` (optional): Phase to start from (1-8) — defaults to 1 (Discovery)
- `results-path` (optional): Path to existing results for mid-lifecycle entry (phases 3-6)
- `skip-review` (optional): Skip Phase 6 human review (for CI/automated mode)
- `target-pass-rate` (optional): Exit threshold — stop iterating when reached (default: 100%)
- `max-iterations` (optional): Maximum optimization iterations (default: 10)

## Mode Detection

The skill auto-detects the evaluation mode from the input format:

| Input file | Detected mode | Behavior |
|-----------|---------------|----------|
| `*.eval.yaml` | Workspace/Agent evaluation | Full feature set: workspace isolation, code judges, multi-provider, multi-turn, tool trajectory |
| `evals.json` | Skill evaluation (compat) | Auto-promotes prompt/expected_output/assertions; resolves files[] paths; agent mode default |
| `*.jsonl` | Dataset evaluation | One test per line with optional YAML sidecar |

All modes flow through the same 8 phases. EVAL.yaml unlocks the richest feature set.

## Evaluation Integrity Constraint

**Critical:** This skill optimizes only **task prompts** (what your agent receives), never **judge prompts** (how evaluators score outputs).

| Prompt Type | Location | Optimize? | Why |
|------------|----------|-----------|-----|
| **Task Prompt** | Referenced in test `input` field (via `file:` references) | ✅ YES | Improves agent performance on the actual task |
| **Judge Prompt** | Used in `assert` evaluator configs (e.g., `llm-judge` prompt) | ❌ NO | Would game the evaluation, not improve the agent |

**Enforcement:**
- Only identify and modify prompts from test case `input` fields
- If a prompt file is referenced ONLY in evaluator configs, it is off-limits
- If a prompt file is referenced in both locations, optimize for the task purpose only
- Document which prompts were modified in the optimization log

## Workflow

### Phase 1: Discovery

Before running or optimizing, understand what you are working with.

**Dispatch the `optimizer-discovery` agent** with the eval path. It will:

1. **Load the Evaluation** — verify `<eval-path>` targets the correct system, read the eval file and all referenced test cases. Supports EVAL.yaml, evals.json, and JSONL formats.
2. **Identify Prompt Files** — infer task prompts from `file:` references in `input` fields only, run integrity checks against evaluator configs, and recursively resolve prompt dependencies.
3. **Identify Optimization Log** — use `<optimization-log-path>` if provided, otherwise create `optimization-[timestamp].md` in the eval's parent directory.
4. **Challenge Assumptions** — assess eval quality, flag ambiguous or contradictory test cases, triage failures into must-fix / nice-to-have / eval-issue, and surface eval issues before proceeding.
5. **Integrity Check** — verify that task prompts referenced in `input` fields are not also present in evaluator configs. Flag any overlap.

**Review the discovery report** before moving to Phase 2. If the agent flags eval issues, fix the eval first.

### Phase 2: Run Baseline

Run evaluations to establish baseline measurements. This phase absorbs the functionality of the former `agentv-eval-orchestrator` skill.

**Execution modes:**

The mode is controlled by the `AGENTV_PROMPT_EVAL_MODE` environment variable:

- **`agent`** (default) — Dispatches `eval-candidate` and `eval-judge` agents. No API keys needed.
- **`cli`** — Runs `agentv eval run <eval-path>` end-to-end. Requires API keys.

**Steps:**

1. **Run baseline evaluation:**

   ```bash
   # CLI mode
   agentv eval run <eval-path>

   # Agent mode — get orchestration prompt and follow it
   agentv prompt eval <eval-path>
   ```

2. **For multi-target comparison:** Run the same eval against multiple providers/configurations to produce paired results for Phase 4.

3. **For evals.json input:** AgentV automatically promotes `prompt` → input messages, `expected_output` → reference answer, converts `assertions` → evaluators, and resolves `files[]` paths.

4. **Record baseline** in the optimization log: score, pass rate, per-test breakdown, and results file path (`.agentv/results/eval_...jsonl`).

**Capabilities preserved from eval-orchestrator:**
- Workspace isolation — clone repos, run setup/teardown scripts
- Multi-provider targets — same eval against Claude, GPT, Copilot, Gemini, custom CLI agents
- Multi-turn conversation evaluation — conversation_id tracking across turns
- Code judges — Python/TypeScript evaluator scripts via `defineCodeJudge()`
- Tool trajectory scoring — evaluate tool call sequences
- Workspace file change tracking — evaluate by diffing workspace files
- All eval formats — EVAL.yaml, evals.json, JSONL
- Agent-mode AND CLI-mode — agent mode (no API keys) and CLI mode (end-to-end)

**Baseline isolation:** Discovery-phase analysis should not contaminate baseline results. Run the baseline before deep-diving into failure patterns to ensure the optimizer's understanding of failures comes from actual eval data, not assumptions.

### Phase 3: Grade

Produce structured grading with per-assertion evidence.

**Dispatch the `eval-judge` agent** (enhanced with claims extraction, #570). For each test case:

1. **Per-assertion structured evidence** — each assertion produces `{text, passed, evidence}` with specific quotes or measurements backing the verdict.
2. **Claims extraction** — extract factual claims from the candidate response and verify each against reference material.
3. **Eval self-critique** — the judge flags its own weak assertions ("this passed, but the assertion is too loose to be meaningful").
4. **Surface vs substance guards** — detect when a response looks good superficially but fails on substance (format compliance ≠ content quality).
5. **User notes integration** — if the user provided notes or context, incorporate them into grading.

**Output:** Write `grading.json` artifact to `.agentv/artifacts/grading.json` (#565).

```json
{
  "eval_path": "<eval-path>",
  "timestamp": "<ISO-8601>",
  "results": [
    {
      "test_id": "...",
      "score": 0.85,
      "assertions": [
        {"text": "Response includes error handling", "passed": true, "evidence": "Lines 12-15 contain try/catch block"},
        {"text": "Uses async/await pattern", "passed": false, "evidence": "Uses .then() callback pattern instead"}
      ],
      "claims": [...],
      "self_critique": ["Assertion 'mentions error handling' is too loose — should check for specific error types"]
    }
  ]
}
```

### Phase 4: Compare

Blind N-way comparison when multiple runs exist. **Skip this phase when only one run exists.**

**Step 1 — Dispatch `blind-comparator` agent** (#571):

1. **Blind presentation** — the comparator receives responses labeled "Response A", "Response B", etc. without knowing which is baseline.
2. **Dynamic rubric generation** — generate task-specific evaluation criteria based on the test case requirements, not a generic rubric.
3. **Multi-dimensional scoring** — evaluate on content quality AND structural quality independently.
4. **N-way comparison** — compare 2+ responses simultaneously, not just binary A/B.
5. **Per-response verdicts** with dimensional breakdowns.

**Step 2 — Dispatch `comparison-analyzer` agent** (#571):

1. **Unblinding** — reveal which response was baseline vs candidate.
2. **Improvement attribution** — identify what specific changes drove improvements or regressions.
3. **Instruction-following scoring** — score how well each response followed the original task instructions.
4. **Actionable suggestions** — produce concrete optimization suggestions from the comparison.

**Output:** Comparison results are included in the grading artifact and fed into Phase 5.

### Phase 5: Analyze

Deep failure analysis combining existing patterns with new capabilities.

**Dispatch `optimizer-reflector` agent** (enhanced with #567 patterns) and `eval-analyzer` agent:

1. **SIMBA pattern** (existing) — self-introspective failure analysis. For each failure: "What specific instruction or lack of instruction caused this?"
2. **GEPA pattern** (existing) — natural language trace reflection. Compare actual vs expected output, diagnose: knowledge gap, instruction ambiguity, hallucination, or wrong approach.
3. **Deterministic-upgrade suggestions** (new, #567) — identify LLM-judge assertions that could be replaced with deterministic evaluators:
   - "Response contains X" → `contains` evaluator
   - "Output matches pattern Y" → `regex` evaluator
   - "Output is valid JSON" → `is-json` evaluator
4. **Weak assertion identification** (new) — flag assertions that always pass or are too vague to meaningfully test anything.
5. **Benchmark pattern analysis** (new) — detect always-pass tests (assertion too loose), always-fail tests (task impossible or assertion wrong), and flaky tests (non-deterministic).
6. **Trend analysis** (existing) — across iterations, detect improving / plateauing / regressing patterns, stagnation, overfitting.

**Output:** Write `benchmark.json` artifact to `.agentv/artifacts/benchmark.json` (#565).

```json
{
  "eval_path": "<eval-path>",
  "timestamp": "<ISO-8601>",
  "aggregate": {"pass_rate": 0.82, "total_tests": 11, "passed": 9, "failed": 2},
  "patterns": {
    "always_pass": ["test-id-1"],
    "always_fail": ["test-id-7"],
    "flaky": [],
    "deterministic_upgrade_candidates": [
      {"test_id": "test-id-3", "current": "llm-judge", "suggested": "contains", "pattern": "checks for keyword presence"}
    ]
  },
  "iteration_trend": [{"iteration": 1, "pass_rate": 0.72}, {"iteration": 2, "pass_rate": 0.82}]
}
```

### Phase 6: Review

Human review checkpoint. **Skip this phase when `skip-review` is set or in CI/automated mode.**

1. **Present results** — show the human reviewer:
   - Current pass rate and delta from baseline
   - Per-test breakdown (pass/fail with evidence)
   - Comparison results (if Phase 4 ran)
   - Analysis insights (deterministic upgrade candidates, weak assertions, pattern analysis)
   - If the HTML dashboard (#562) is available, reference it for interactive exploration.

2. **Collect structured feedback** — prompt the human for:
   - Approve: continue to optimization
   - Reject: stop, the eval or agent needs rethinking
   - Redirect: change optimization strategy or focus area
   - Notes: free-form feedback to incorporate into subsequent phases

3. **Output:** Write `feedback.json` artifact to `.agentv/artifacts/feedback.json` (#568).

   ```json
   {
     "timestamp": "<ISO-8601>",
     "iteration": 2,
     "decision": "approve",
     "notes": "Focus on test-id-7, the error handling case is critical",
     "redirect": null
   }
   ```

4. **Gate:** Do not proceed to Phase 7 without human approval (unless `skip-review` is set). If the reviewer redirects, return to the appropriate phase with updated context.

### Phase 7: Optimize

Apply surgical prompt refinements based on analysis.

**Step 1 — Dispatch `optimizer-curator` agent:**

1. Provide the reflector's strategy, comparison insights, and human feedback (if any).
2. The curator applies atomic operations to task prompts:
   - **ADD** — insert a new rule for a missing constraint
   - **UPDATE** — refine an existing rule for clarity or generality
   - **DELETE** — remove obsolete, redundant, or harmful rules
   - **NEGATIVE CONSTRAINT** — explicitly state what NOT to do
3. Returns a log entry: operation, target, change, trigger, rationale, score, insight.

**Step 2 — Dispatch `optimizer-polish` agent** (when nearing convergence):

1. Generalize specific patches into broad principles.
2. Remove redundancy and contradictions.
3. Ensure prompt quality: clear persona, specific task, measurable success criteria, <200 lines.

**Step 3 — Verify polish didn't regress:**
- Run the eval one final time after polish changes.
- If score decreased, revert polish and keep the working version.

**Variant tracking:** When a change improves some tests but regresses others, maintain 2-3 promising prompt variants. Compare variants to find the best overall approach before converging.

**Log result:** Append the curator's log entry to the optimization log file.

### Phase 8: Re-run + Iterate

Loop back to Phase 2 with the modified prompts.

1. **Re-run evaluation** with the optimized prompts. The new results become the comparison baseline for the next iteration.
2. **Compare against previous iteration** — Phase 4 now compares current vs previous iteration (not just original baseline).
3. **Exit conditions** — stop iterating when ANY of:
   - `target-pass-rate` is reached
   - Human approves the result in Phase 6
   - Stagnation detected (no improvement for 2 consecutive iterations)
   - `max-iterations` exhausted
4. **On exit:** Proceed to handoff — document all changes, report final vs baseline score, suggest future improvements, and finalize the optimization log.

**Human checkpoints:** At iterations 3, 6, and 9, present progress to the user regardless of `skip-review`. Push back if optimization is accumulating contradictory rules or overfitting.

## Entering Mid-Lifecycle

Users can start at any phase by providing existing data:

| Entry point | Required input | Example prompt |
|------------|---------------|----------------|
| Phase 1 (Discovery) | `eval-path` | "Optimize my agent against evals/support.yaml" |
| Phase 2 (Run) | `eval-path` | "Run this eval and show me results" |
| Phase 3 (Grade) | `eval-path` + `results-path` | "Grade these eval results" |
| Phase 4 (Compare) | Two or more result sets | "Compare these two eval runs" |
| Phase 5 (Analyze) | `results-path` | "Analyze why my agent is failing on these results" |
| Phase 6 (Review) | `results-path` + analysis | "Review these eval results before I optimize" |
| Phase 7 (Optimize) | `eval-path` + analysis/strategy | "Apply these optimization suggestions" |

When entering mid-lifecycle, the skill runs only the requested phase and subsequent phases. It does NOT re-run earlier phases unless the user requests a full loop.

## Agent Dispatch Reference

This skill orchestrates up to eight specialized agents. The skill handles phase transitions, decision-making, and iteration control; agents handle autonomous work within each phase.

| Agent | Phase | Input | Output |
|-------|-------|-------|--------|
| `optimizer-discovery` | 1 (Discovery) | Eval path | Discovery report (targets, triage, eval quality) |
| `eval-candidate` | 2 (Run) | Eval path, test ID | Candidate response (agent mode only) |
| `eval-judge` | 2–3 (Run, Grade) | Eval path, test ID, answer | Structured grading with evidence |
| `blind-comparator` | 4 (Compare) | Blinded responses, task context | Blind dimensional scores |
| `comparison-analyzer` | 4 (Compare) | Blind results, response mapping | Unblinded analysis with suggestions |
| `eval-analyzer` | 5 (Analyze) | Results, eval config | Deterministic-upgrade suggestions, weak assertions, patterns |
| `optimizer-reflector` | 5 (Analyze) | Results JSONL, iteration number | SIMBA/GEPA analysis, strategy, stagnation check |
| `optimizer-curator` | 7 (Optimize) | Strategy, prompt file paths | Log entry (operation, change, rationale) |
| `optimizer-polish` | 7 (Optimize) | Prompt files, optimization log | Polish report (generalizations, quality) |

**What the skill handles directly** (not delegated to agents):
- Phase 2: Choosing execution mode (agent vs CLI), multi-target orchestration
- Phase 6: Human interaction, collecting feedback, gate decisions
- Phase 8: Iteration control, exit condition evaluation, baseline comparison
- Cross-phase: Artifact collection, optimization log maintenance, variant tracking

## Companion Artifacts

The skill produces structured artifacts at key phases (#565):

| Artifact | Phase | Path | Description |
|----------|-------|------|-------------|
| `grading.json` | 3 (Grade) | `.agentv/artifacts/grading.json` | Per-assertion evidence, claims, self-critique |
| `benchmark.json` | 5 (Analyze) | `.agentv/artifacts/benchmark.json` | Aggregate metrics, patterns, upgrade candidates |
| `feedback.json` | 6 (Review) | `.agentv/artifacts/feedback.json` | Human reviewer decision and notes |
| Results JSONL | 2 (Run) | `.agentv/results/eval_*.jsonl` | Raw per-test results (existing format) |
| Optimization log | All | `<optimization-log-path>` | Running narrative of all changes and decisions |

Artifacts use schemas compatible with skill-creator's eval-viewer where applicable.

## Guidelines

- **Generalization First**: Prefer broad, principle-based guidelines over specific examples or "hotfixes". Only use specific rules if generalized instructions fail to achieve the desired score.
- **Simplicity ("Less is More")**: Avoid overfitting to the test set. If a specific rule doesn't significantly improve the score compared to a general one, choose the general one.
- **Structure**: Maintain existing Markdown headers/sections in optimized prompts.
- **Progressive Disclosure**: If the prompt grows too large (>200 lines), consider moving specialized logic into a separate file or skill.
- **Quality Criteria**: Ensure the prompt defines a clear persona, specific task, and measurable success criteria.
- **Isolation**: Never let discovery-phase knowledge contaminate baseline runs. Run first, analyze second.
- **Integrity**: Never optimize judge prompts. Evaluation must remain an independent measure of agent quality.
