# AgentV Features Examples

This directory demonstrates AgentV's evaluation features with complete, working examples organized by capability.

## Key Files

### Evaluation Files (`evals/`)

Organized by feature area:

#### Basic Features (`evals/basic/`)

- **`example-eval.yaml`**: Core schema demonstration showing:
  - Basic features: `input_messages`, `expected_messages`
  - File references and content blocks
  - Conversation threading with `conversation_id`
  - Multiple evaluators (code + LLM judge)
  - Target overrides per eval case

#### Rubric Evaluator (`evals/rubric/`)

- **`rubric-examples.yaml`**: Rubric evaluator feature demonstration showing:
  - Inline rubrics (simple strings and detailed objects)
  - `expected_outcome` field
  - Rubric weights and required flags
  - Verdict field (pass/fail/borderline)
  - Automatic rubric generation from expected outcomes

#### Tool Trajectory Evaluator (`evals/tool-trajectory/`)

- **`tool-trajectory-demo.yaml`**: Tool trajectory evaluator for agent execution validation:
  - `any_order` mode: Validates minimum tool call counts (tools can appear in any order)
  - `in_order` mode: Validates tools appear in expected sequence (allows gaps)
  - `exact` mode: Validates exact tool sequence match (no gaps, no extra tools)

- **`expected-messages-demo.yaml`**: Expected tool calls evaluator for tool_calls validation:
  - Validates `tool_calls` in `expected_messages` against actual trace (evaluator type: `expected_tool_calls`)
  - Supports optional `input` matching for precise validation
  - Sequential matching with partial scoring

**Setup for tool-trajectory demos:**

1. Create a `.env` file in `examples/features/` with:
   ```
   TOOL_TRAJECTORY_DIR=/absolute/path/to/examples/features/evals/tool-trajectory
   ```

2. Run the demos:
   ```bash
   cd examples/features
   npx agentv eval evals/tool-trajectory/tool-trajectory-demo.yaml --target mock_agent
   npx agentv eval evals/tool-trajectory/expected-messages-demo.yaml --target mock_agent
   ```

Note: These demos use a mock CLI agent that simulates tool usage. For real agent evaluation, use providers that return trace data (e.g., codex, vscode)

### Evaluator Components (`evaluators/`)

- **`scripts/`**: Code-based evaluators (Python, shell, etc.)
  - Input: JSON with eval case data via stdin
  - Output: JSON with score, passed flag, and reasoning
  - Example: `check_python_keywords.py` validates Python code quality

- **`prompts/`**: LLM judge prompt templates (Markdown)
  - Define how an LLM should evaluate outputs
  - Include scoring guidelines and output format
  - Example: `code-correctness-judge.md` for semantic code review

### Shared Instruction Files (`prompts/`)

- **`python.instructions.md`**: Python coding guidelines
- **`javascript.instructions.md`**: JavaScript coding guidelines
- These instruction files can be referenced in eval files to provide context

