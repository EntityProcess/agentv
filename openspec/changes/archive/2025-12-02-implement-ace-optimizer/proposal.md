# Implement ACE Optimizer

**Status: Rejected** - Replaced by `prompt-optimizer` skill.

## Summary
Implement automatic prompt optimization in AgentV using the Ax library's ACE (Automatic Cognitive Enhancement) algorithm. This allows users to automatically improve their prompts based on evaluation results defined in AgentV eval files.

## Problem
Currently, AgentV provides evaluation capabilities, allowing users to score their agents/prompts against test cases. However, improving the prompts based on these scores is a manual and iterative process. Users have to manually analyze failures, tweak the prompt, and re-run evals.

## Solution
Integrate the Ax library's ACE optimization algorithm into AgentV.
- Introduce a new `optimize` command in the CLI.
- Define a YAML configuration schema for optimizers (minimal viable set: type, eval_files, playbook_path, max_epochs, allow_dynamic_sections).
- Implement an optimization engine in `@agentv/core` that bridges AgentV's evaluation system with Ax's optimization loop.
- Support the generation and updating of "playbooks" (lightweight JSON files containing structured optimization insights as tagged bullets organized into sections).
- Initial version supports a single numeric objective (0-1 range), which can be a weighted combination of existing eval metrics.

## Risks
- **Dependency Complexity**: Integrating `@ax-llm/ax` might introduce complex dependencies or version conflicts.
- **Performance**: Optimization loops can be slow and costly (LLM calls). We need to ensure the user has control over costs (e.g., max epochs).
- **Integration**: Mapping AgentV's evaluation results (which can be complex multi-objective scores) to a single scalar score required by some optimizers (though ACE might handle more complex feedback) needs careful design.
