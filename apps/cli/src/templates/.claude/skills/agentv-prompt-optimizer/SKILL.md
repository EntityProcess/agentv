---
description: Iteratively optimize prompt files against AgentV evaluation datasets by analyzing failures and refining instructions.
---

# AgentV Prompt Optimizer

## Input Variables
- `eval-path`: Path or glob pattern to the AgentV evaluation file(s) to optimize against
- `optimization-log-path` (optional): Path where optimization progress should be logged

## Workflow

1.  **Initialize**
    - Verify `<eval-path>` (file or glob) targets the correct system.
    - **Identify Prompt Files**:
        - Infer prompt files from the eval file content (look for `file:` references in `input_messages` that match these patterns).
        - Recursively check referenced prompt files for *other* prompt references (dependencies).
        - If multiple prompts are found, consider ALL of them as candidates for optimization.
    - **Identify Optimization Log**:
        - If `<optimization-log-path>` is provided, use it.
        - If not, create a new one in the parent directory of the eval files: `optimization-[timestamp].md`.
    - Read content of the identified prompt file.

2.  **Optimization Loop** (Max 5 iterations)
    - **Execute (The Generator)**: Run `agentv eval <eval-path>`.
    - **Analyze (The Reflector)**:
        - Locate the results file path from the console output (e.g., `.agentv/results/eval_...jsonl`).
        - Read the results file. Calculate pass rate.
        - **Root Cause Analysis**: For each failure, perform a deep dive:
            - **Error Identification**: What exactly went wrong? (e.g., "Predicted 'High' but expected 'Low'")
            - **Root Cause**: Why did it happen? (e.g., "Ambiguous definition of 'High' severity", "Hallucinated a constraint", "Incorrect test expectation")
            - **Correct Approach**: What *should* the model have done?
            - **Key Insight**: What general rule or pattern can we learn from this?
            - **Regression Check**: Did this change break previously passing tests? If so, mark the previous change as "Harmful".
    - **Decide**:
        - If **100% pass**: STOP and report success.
        - If **Score decreased**: Revert last change, try different approach.
        - If **No improvement** (2x): STOP and report stagnation.
    - **Refine & Log (The Curator)**:
        - **Orchestrate Subagent**: Use `runSubagent` to perform the file modifications and logging.
            - **Prompt Structure**:
                1. **Read**: Instruct to read the relevant prompt file(s).
                2. **Modify**: List specific failures/misses and the specific changes to make (strategies).
                3. **Log**: Provide the exact log entry text to append to the optimization log.
                    - **Format**:
                      ```markdown
                      ### Iteration [N]
                      - **Change**: [Description of edit]
                      - **Rationale**: [Root Cause / Why this fix was chosen]
                      - **Outcome**: [Success / Failure / Harmful] (Score: X% -> Y%)
                      - **Insight**: [Key learning or pattern identified]
                      ```
        - **Strategy**: Treat the prompt as a structured set of rules and instructions.
            - **Clarify**: If ambiguous, make the existing instruction more specific.
            - **Generalize**: If multiple specific rules address similar underlying principles, refactor them into a single high-level guideline (First Principles).
            - **Add Rule**: If a constraint was missed, add a specific bullet point to the relevant section.
            - **Negative Constraint**: If hallucinating, explicitly state what NOT to do. Prefer generalized prohibitions over specific forbidden tokens where possible.
            - **Consolidate**: Check for redundant or overlapping instructions and merge them.
            - **Safety Check**: Ensure new rules don't contradict existing ones (unless intended).
        - **Constraint**: Avoid rewriting large sections. Make surgical, additive changes to preserve existing behavior.

3.  **Completion**
    - Report final score.
    - Summarize key changes made to the prompt.
    - **Finalize Optimization Log**: Add a summary header to the optimization log file indicating the session completion and final score.

## Guidelines
- **Generalization First**: Prefer broad, principle-based guidelines over specific examples or "hotfixes". Only use specific rules if generalized instructions fail to achieve the desired score.
- **Simplicity ("Less is More")**: Avoid overfitting to the test set. If a specific rule doesn't significantly improve the score compared to a general one, choose the general one.
- **Structure**: Maintain existing Markdown headers/sections.
- **Progressive Disclosure**: If the prompt grows too large (>200 lines), consider moving specialized logic into a separate file or skill.
- **Quality Criteria**: Ensure the prompt defines a clear persona, specific task, and measurable success criteria.
