---
name: agentv-optimizer
description: Optimize agent prompts through evaluation-driven refinement. Five-phase workflow (Discovery → Planning → Optimization → Polish → Handoff) that ensures evaluation integrity and keeps the user in control.
---

# AgentV Optimizer

## Overview

An agent **is** its prompts. This skill teaches patterns for agent self-improvement: using AgentV evaluations to iteratively refine the task prompts that drive agent behavior. Unlike static evaluation, this enables continuous agent improvement grounded in actual measurement.

The workflow is structured into five phases: Discovery, Planning, Optimization, Polish, and Handoff. This ensures the optimizer understands what it is optimizing before touching prompts, keeps the user in control at key decision points, and delivers a professional result rather than a collection of patches.

## Input Variables
- `eval-path`: Path or glob pattern to the AgentV evaluation file(s) to optimize against
- `optimization-log-path` (optional): Path where optimization progress should be logged

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

**Why this matters:** Optimizing judge prompts makes your agent *appear* better without actually improving it. Evaluation must remain an independent measure of agent quality.

## Workflow

### Phase 1: Discovery

Before optimizing, understand what you are working with.

**Dispatch the `optimizer-discovery` agent** with the eval path. It will:

1.  **Load the Evaluation** — verify `<eval-path>` targets the correct system, read the eval file and all referenced test cases.
2.  **Identify Prompt Files** — infer task prompts from `file:` references in `input` fields only, run integrity checks against evaluator configs, and recursively resolve prompt dependencies.
3.  **Identify Optimization Log** — use `<optimization-log-path>` if provided, otherwise create `optimization-[timestamp].md` in the eval's parent directory.
4.  **Challenge Assumptions** — assess eval quality, flag ambiguous or contradictory test cases, triage failures into must-fix vs nice-to-have, and surface eval issues before proceeding.

**Review the discovery report** before moving to Phase 2. If the agent flags eval issues, fix the eval first.

### Phase 2: Planning

Propose a strategy before touching any prompts.

1.  **Run Baseline**
    - Execute `agentv prompt eval <eval-path>` to establish the current pass rate.
    - Record baseline score in the optimization log.

2.  **Assess Complexity**
    - **Simple**: Prompt needs clarification or missing constraints (expect 1-3 iterations).
    - **Moderate**: Prompt structure needs reorganization or multiple concerns are entangled (expect 3-6 iterations).
    - **Fundamental**: Agent's approach is wrong, needs rethinking (consider whether prompt optimization alone is sufficient).

3.  **Propose Strategy**
    - Identify the top failure patterns from the baseline run.
    - Propose an optimization approach: which failures to tackle first, what kind of changes to make.
    - Identify dependencies and risks (e.g., fixing one failure pattern may break passing tests).

4.  **Get User Alignment**
    - Present the strategy to the user before proceeding.
    - If the agent needs fundamental restructuring, say so — don't just patch.
    - Confirm the user is aligned on approach before entering the optimization loop.

### Phase 3: Optimization Loop

Max 10 iterations. This is the core refinement cycle.

1.  **Execute (The Generator)**
    - Run `agentv prompt eval <eval-path>` and follow its orchestration instructions.
    - *Targeted Run*: If iterating on specific stubborn failures, pass `--test-id <test_id>` to filter to specific tests.

2.  **Analyze — Dispatch `optimizer-reflector` agent**
    - Provide the results file path (`.agentv/results/eval_...jsonl`) and the current iteration number.
    - The reflector performs self-introspective analysis (SIMBA pattern) and natural language trace reflection (GEPA pattern).
    - Returns a structured reflection report with: score, root cause analysis, high-variability cases, strategy, and stagnation check.

3.  **Decide**
    - If **100% pass**: Proceed to Phase 4 (Polish).
    - If **Score decreased**: Revert last change, try different approach.
    - If **No improvement** (2x): STOP and report stagnation, or try a fundamentally different approach.
    - **Human checkpoint**: At iterations 3, 6, and 9, present progress to the user and confirm direction. Push back if the optimization is going down a bad path (e.g., accumulating contradictory rules, overfitting to specific test cases).
    - **Variant tracking**: When a change improves some tests but regresses others, consider maintaining 2-3 promising prompt variants rather than single-path iteration. Compare variants to find the best overall approach before converging.

4.  **Refine — Dispatch `optimizer-curator` agent**
    - Provide the reflector's strategy and the prompt file path(s).
    - The curator applies surgical, atomic operations (ADD / UPDATE / DELETE / NEGATIVE CONSTRAINT) to the task prompt.
    - Returns a log entry documenting the operation, target, change, trigger, rationale, score, and insight.

5.  **Log Result**
    - Append the **Log Entry** returned by the Curator to the optimization log file.

### Phase 4: Polish

Before handing off, clean up the prompt so it reads as a coherent document.

**Dispatch the `optimizer-polish` agent** with the prompt file(s) and the optimization log. It will:

1.  **Generalize Patches into Principles** — consolidate specific fixes into broad guidelines.
2.  **Remove Redundancy and Contradictions** — eliminate overlapping or conflicting rules.
3.  **Ensure Prompt Quality** — verify clear persona, specific task, measurable success criteria, and manageable length (<200 lines).

**Review the polish report**, then:

4.  **Verify Polish Didn't Regress**
    - Run the eval one final time after polish changes.
    - If score decreased, revert polish changes and keep the working (if messy) version.

### Phase 5: Handoff

Ensure the user understands what changed and can maintain the optimized agent.

1.  **Document All Changes**
    - Summarize what was changed and why in the optimization log.
    - For each significant change, include the rationale (not just "fixed test X" but "the agent was hallucinating Y because the prompt lacked constraint Z").

2.  **Report Final Results**
    - Report final score and comparison to baseline.
    - Highlight any test cases that still fail and why.

3.  **Suggest Future Improvements**
    - Identify improvements beyond current eval coverage (v2 ideas).
    - Note any areas where the eval itself should be expanded.
    - Flag any fragile optimizations that may break with future changes.

4.  **Finalize Optimization Log**
    - Add a summary header to the optimization log file indicating session completion, baseline score, final score, and key decisions made.

## Agent Dispatch Reference

This skill orchestrates four predefined agents. The skill handles coordination and decision-making; agents handle autonomous work.

| Agent | Dispatched in | Input | Output |
|-------|--------------|-------|--------|
| `optimizer-discovery` | Phase 1 | Eval path | Discovery report (targets, triage, eval quality) |
| `optimizer-reflector` | Phase 3 (each iteration) | Results JSONL path, iteration number | Reflection report (scores, root causes, strategy) |
| `optimizer-curator` | Phase 3 (each iteration) | Reflector strategy, prompt file path(s) | Log entry (operation, change, rationale) |
| `optimizer-polish` | Phase 4 | Prompt file(s), optimization log | Polish report (changes made, quality assessment) |

**What the skill handles directly** (not delegated to agents):
- Phase 2 (Planning): Running baseline, assessing complexity, getting user alignment
- Phase 3 (Decide): Evaluating scores, reverting changes, human checkpoints, variant tracking
- Phase 5 (Handoff): Documenting changes, reporting results, suggesting v2 improvements

## Guidelines
- **Generalization First**: Prefer broad, principle-based guidelines over specific examples or "hotfixes". Only use specific rules if generalized instructions fail to achieve the desired score.
- **Simplicity ("Less is More")**: Avoid overfitting to the test set. If a specific rule doesn't significantly improve the score compared to a general one, choose the general one.
- **Structure**: Maintain existing Markdown headers/sections.
- **Progressive Disclosure**: If the prompt grows too large (>200 lines), consider moving specialized logic into a separate file or skill.
- **Quality Criteria**: Ensure the prompt defines a clear persona, specific task, and measurable success criteria.
