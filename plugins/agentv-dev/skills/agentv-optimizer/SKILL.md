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

1.  **Load the Evaluation**
    - Verify `<eval-path>` (file or glob) targets the correct system.
    - Read the eval file and all referenced test cases.

2.  **Identify Prompt Files**
    - Infer prompt files from the eval file content (look for `file:` references in `input` fields **only**).
    - **Integrity check**: Verify that identified prompt files are NOT referenced in `assert` evaluator configurations. If a prompt appears in both locations, treat it as a task prompt and do not modify it in ways that would optimize for evaluation scoring rather than task correctness.
    - Recursively check referenced prompt files for *other* prompt references (dependencies).
    - If multiple prompts are found, consider ALL of them as candidates for optimization.
    - Read content of the identified prompt file(s).

3.  **Identify Optimization Log**
    - If `<optimization-log-path>` is provided, use it.
    - If not, create a new one in the parent directory of the eval files: `optimization-[timestamp].md`.

4.  **Challenge Assumptions**
    - Is the eval well-designed? Are the test cases representative of real usage?
    - Are there test cases that are ambiguous, contradictory, or testing the wrong thing?
    - Separate failures into **must fix** (clear agent deficiency) vs **nice to have** (edge cases, debatable expectations).
    - If the eval itself is flawed, surface issues to the user before proceeding. Suggest eval fixes first — optimizing prompts against a bad eval wastes effort.

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

2.  **Analyze (The Reflector)**
    - Locate the results file path (`.agentv/results/eval_...jsonl`).
    - **Orchestrate Subagent**: Use `runSubagent` to analyze the results.
        - **Task**: Read the results file, calculate pass rate, and perform root cause analysis.
        - **Self-introspective analysis** (SIMBA pattern): Have the agent explain *why* it failed, not just *that* it failed. Include the agent's reasoning trace in the analysis — what did it think it was doing, and where did that reasoning go wrong?
        - **Natural language reflection** (GEPA pattern): Reflect on execution traces in natural language, not just pass/fail metrics. Describe the behavioral pattern that led to failure.
        - **Output**: Return a structured analysis including:
            - **Score**: Current pass rate.
            - **Root Cause**: Why failures occurred (e.g., "Ambiguous definition", "Hallucination").
            - **Insight**: Key learning or pattern identified from the failures.
            - **Strategy**: High-level plan to fix the prompt (e.g., "Clarify section X", "Add negative constraint").

3.  **Decide**
    - If **100% pass**: Proceed to Phase 4 (Polish).
    - If **Score decreased**: Revert last change, try different approach.
    - If **No improvement** (2x): STOP and report stagnation, or try a fundamentally different approach.
    - **Human checkpoint**: At iterations 3, 6, and 9, present progress to the user and confirm direction. Push back if the optimization is going down a bad path (e.g., accumulating contradictory rules, overfitting to specific test cases).
    - **Variant tracking**: When a change improves some tests but regresses others, consider maintaining 2-3 promising prompt variants rather than single-path iteration. Compare variants to find the best overall approach before converging.

4.  **Refine (The Curator)**
    - **Orchestrate Subagent**: Use `runSubagent` to apply the fix.
        - **Task**: Read the relevant prompt file(s), apply the **Strategy** from the Reflector, and generate the log entry.
        - **Output**: The **Log Entry** describing the specific operation performed.
              ```markdown
              ### Iteration [N]
              - **Operation**: [ADD / UPDATE / DELETE]
              - **Target**: [Section Name]
              - **Change**: [Specific text added/modified]
              - **Trigger**: [Specific failing test case or error pattern]
              - **Rationale**: [From Reflector: Root Cause]
              - **Score**: [From Reflector: Current Pass Rate]
              - **Insight**: [From Reflector: Key Learning]
              ```
    - **Strategy**: Treat the prompt as a structured set of rules. Execute atomic operations:
        - **ADD**: Insert a new rule if a constraint was missed.
        - **UPDATE**: Refine an existing rule to be clearer or more general.
            - *Clarify*: Make ambiguous instructions specific.
            - *Generalize*: Refactor specific fixes into high-level principles (First Principles).
        - **DELETE**: Remove obsolete, redundant, or harmful rules.
            - *Prune*: If a general rule covers specific cases, delete the specific ones.
        - **Negative Constraint**: If hallucinating, explicitly state what NOT to do. Prefer generalized prohibitions over specific forbidden tokens where possible.
        - **Safety Check**: Ensure new rules don't contradict existing ones (unless intended).
    - **Constraint**: Avoid rewriting large sections. Make surgical, additive changes to preserve existing behavior.

5.  **Log Result**
    - Append the **Log Entry** returned by the Curator to the optimization log file.

### Phase 4: Polish

Before handing off, clean up the prompt so it reads as a coherent document.

1.  **Generalize Patches into Principles**
    - Review all changes made during the optimization loop.
    - Where multiple specific fixes address the same underlying issue, consolidate them into a single principle-based guideline.
    - Prefer broad, principle-based guidelines over specific examples or "hotfixes". Only keep specific rules if generalized instructions fail to achieve the desired score.

2.  **Remove Redundancy and Contradictions**
    - Check for rules that overlap or conflict.
    - If a general rule covers specific cases, delete the specific ones.
    - Resolve any contradictions introduced during iterative refinement.

3.  **Ensure Prompt Quality**
    - The prompt should define a clear **persona**, specific **task**, and measurable **success criteria**.
    - Maintain existing Markdown headers/sections and structure.
    - If the prompt has grown too large (>200 lines), consider moving specialized logic into a separate file or skill.

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

## Guidelines
- **Generalization First**: Prefer broad, principle-based guidelines over specific examples or "hotfixes". Only use specific rules if generalized instructions fail to achieve the desired score.
- **Simplicity ("Less is More")**: Avoid overfitting to the test set. If a specific rule doesn't significantly improve the score compared to a general one, choose the general one.
- **Structure**: Maintain existing Markdown headers/sections.
- **Progressive Disclosure**: If the prompt grows too large (>200 lines), consider moving specialized logic into a separate file or skill.
- **Quality Criteria**: Ensure the prompt defines a clear persona, specific task, and measurable success criteria.
