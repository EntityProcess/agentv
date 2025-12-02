---
description: Iteratively optimize a prompt file against an AgentV evaluation suite by analyzing failures and refining instructions.
---

# AgentV Prompt Optimizer

Iteratively optimize a prompt file against an AgentV evaluation suite.

## Usage
`prompt-optimizer <prompt-file> <eval-path>`

## Workflow

1.  **Initialize**
    - Read content of `<prompt-file>`.
    - Verify `<eval-path>` (file or glob) targets the correct prompt or system.

2.  **Optimization Loop** (Max 5 iterations)
    - **Execute (The Generator)**: Run `pnpm agentv eval <eval-path>`.
    - **Analyze (The Reflector)**:
        - Locate the results file path from the console output (e.g., `.agentv/results/eval_...jsonl`).
        - Read the results file. Calculate pass rate.
        - **Root Cause Analysis**: For each failure, determine WHY it failed (e.g., Ambiguity, Format Violation, Hallucination, or Conflict).
    - **Decide**:
        - If **100% pass**: STOP and report success.
        - If **Score decreased**: Revert last change, try different approach.
        - If **No improvement** (2x): STOP and report stagnation.
    - **Refine (The Curator)**:
        - Modify `<prompt-file>` to address failures.
        - **Strategy**: Treat the prompt as a structured "Playbook".
            - **Clarify**: If ambiguous, make the existing instruction more specific.
            - **Add Rule**: If a constraint was missed, add a specific bullet point to the relevant section.
            - **Negative Constraint**: If hallucinating, explicitly state what NOT to do.
        - **Constraint**: Avoid rewriting large sections. Make surgical, additive changes to preserve existing behavior.
        - **Apply**: Use `replace_string_in_file`.

3.  **Completion**
    - Report final score.
    - Summarize key changes made to the prompt.
    - **Update Playbook**: Append a brief note to `<prompt-filename>.playbook.md` (create if missing) recording what worked and what didn't.
      ```markdown
      ## [Date] Optimization Session
      - [Success] Added reasoning step -> +15% score
      - [Failure] Removed examples -> -10% score (Reverted)
      ```

## Guidelines
- **Token Efficiency**: Keep prompt changes concise. Remove redundant instructions.
- **Structure**: Maintain existing Markdown headers/sections.
- **Reasoning**: Prefer adding "Chain of Thought" or "Step-by-Step" instructions over rigid rules for complex logic.
