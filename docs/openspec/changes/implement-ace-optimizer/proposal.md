# Implement ACE Optimizer

## Summary
Implement automatic prompt optimization in AgentV using the Ax library's ACE (Automatic Cognitive Enhancement) algorithm. This allows users to automatically improve their prompts based on evaluation results defined in AgentV eval files.

## Problem
Currently, AgentV provides evaluation capabilities, allowing users to score their agents/prompts against test cases. However, improving the prompts based on these scores is a manual and iterative process. Users have to manually analyze failures, tweak the prompt, and re-run evals.

## Solution
Integrate the Ax library's ACE optimization algorithm into AgentV.
- Introduce a new `optimize` command in the CLI.
- Define a YAML configuration schema for optimizers.
- Implement an optimization engine in `@agentv/core` that bridges AgentV's evaluation system with Ax's optimization loop.
- Support the generation and updating of "playbooks" (learned optimization insights) that can be used to enhance prompts.

## Risks
- **Dependency Complexity**: Integrating `@ax-llm/ax` might introduce complex dependencies or version conflicts.
- **Performance**: Optimization loops can be slow and costly (LLM calls). We need to ensure the user has control over costs (e.g., max epochs).
- **Integration**: Mapping AgentV's evaluation results (which can be complex multi-objective scores) to a single scalar score required by some optimizers (though ACE might handle more complex feedback) needs careful design.
