---
description: Iteratively optimize a prompt file against an AgentV evaluation suite by analyzing failures and refining instructions.
---

# AgentV Prompt Optimizer

Iteratively optimize a prompt file against an AgentV evaluation suite.

## Usage
`prompt-optimizer <eval-path> [playbook-path]`

## Workflow

1.  **Initialize**
    - Verify `<eval-path>` (file or glob) targets the correct system.
    - **Identify Prompt Files**:
        - Infer prompt files from the eval file content (look for `file:` references in `input_messages` that match these patterns).
        - Recursively check referenced prompt files for *other* prompt references (dependencies).
        - If multiple prompts are found, consider ALL of them as candidates for optimization.
    - **Identify Playbook**:
        - If `<playbook-path>` is provided, use it.
        - If not, create a new one in the parent directory of the eval files: `playbook-[timestamp].md`.
    - Read content of the identified prompt file.

2.  **Optimization Loop** (Max 5 iterations)
    - **Execute (The Generator)**: Run `pnpm agentv eval <eval-path>`.
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
    - **Log Result**:
        - Append the result of this iteration to the identified playbook file.
        - **Format**:
          ```markdown
          ### Iteration [N]
          - **Change**: [Description of edit]
          - **Rationale**: [Root Cause / Why this fix was chosen]
          - **Outcome**: [Success / Failure / Harmful] (Score: X% -> Y%)
          - **Insight**: [Key learning or pattern identified]
          ```
    - **Refine (The Curator)**:
        - Modify the relevant `<prompt-file>` (pick the one most likely to be the root cause) to address failures.
        - **Strategy**: Treat the prompt as a structured "Playbook".
            - **Clarify**: If ambiguous, make the existing instruction more specific.
            - **Add Rule**: If a constraint was missed, add a specific bullet point to the relevant section.
            - **Negative Constraint**: If hallucinating, explicitly state what NOT to do.
            - **Consolidate**: Check for redundant or overlapping instructions and merge them.
            - **Safety Check**: Ensure new rules don't contradict existing ones (unless intended).
        - **Constraint**: Avoid rewriting large sections. Make surgical, additive changes to preserve existing behavior.
        - **Apply**: Use `replace_string_in_file`.

3.  **Completion**
    - Report final score.
    - Summarize key changes made to the prompt.
    - **Finalize Playbook**: Add a summary header to the playbook file indicating the session completion and final score.

## Guidelines
- **Simplicity ("Less is More")**: Avoid adding specific rules for rare edge cases ("hotfixes"). Focus on universally applicable instructions.
- **Structure**: Maintain existing Markdown headers/sections.
- **Progressive Disclosure**: If the prompt grows too large (>200 lines), consider moving specialized logic into a separate file or skill.
- **Quality Criteria**: Ensure the prompt defines a clear persona, specific task, and measurable success criteria.
