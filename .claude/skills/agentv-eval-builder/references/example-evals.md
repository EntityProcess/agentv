# Example Eval Files

This document contains complete examples of well-structured eval files demonstrating various AgentV patterns and best practices.

## Basic Example: Simple Q&A Eval

```yaml
description: Basic arithmetic evaluation
execution:
  target: default

evalcases:
  - id: simple-addition
    expected_outcome: Correctly calculates 2+2
    
    input_messages:
      - role: user
        content: What is 2 + 2?
    
    expected_messages:
      - role: assistant
        content: "4"
```

## Code Review with File References

```yaml
description: Code review with guidelines
execution:
  target: azure_base

evalcases:
  - id: code-review-basic
    expected_outcome: Assistant provides helpful code analysis with security considerations
    
    input_messages:
      - role: system
        content: You are an expert code reviewer.
      - role: user
        content:
          - type: text
            value: |-
              Review this function for security issues:
              
              ```python
              def get_user(user_id):
                  query = f"SELECT * FROM users WHERE id = {user_id}"
                  return db.execute(query)
              ```
          - type: file
            value: /prompts/security-guidelines.md
    
    expected_messages:
      - role: assistant
        content: |-
          This code has a critical SQL injection vulnerability. The user_id is directly 
          interpolated into the query string without sanitization.
          
          Recommended fix:
          ```python
          def get_user(user_id):
              query = "SELECT * FROM users WHERE id = ?"
              return db.execute(query, (user_id,))
          ```
```

## Multi-Evaluator Configuration

```yaml
description: JSON generation with validation
execution:
  target: default

evalcases:
  - id: json-generation-with-validation
    expected_outcome: Generates valid JSON with required fields
    
    execution:
      evaluators:
        - name: json_format_validator
          type: code_judge
          script: uv run validate_json.py
          cwd: ./evaluators
        - name: content_evaluator
          type: llm_judge
          prompt: ./judges/semantic_correctness.md
    
    input_messages:
      - role: user
        content: |-
          Generate a JSON object for a user with name "Alice", 
          email "alice@example.com", and role "admin".
    
    expected_messages:
      - role: assistant
        content: |-
          {
            "name": "Alice",
            "email": "alice@example.com",
            "role": "admin"
          }
```

## Tool Trajectory Evaluation

Validate that an agent uses specific tools during execution.

```yaml
description: Tool usage validation
execution:
  target: mock_agent

evalcases:
  # Validate minimum tool usage (order doesn't matter)
  - id: research-depth
    expected_outcome: Agent researches thoroughly
    input_messages:
      - role: user
        content: Research REST vs GraphQL
    execution:
      evaluators:
        - name: research-check
          type: tool_trajectory
          mode: any_order
          minimums:
            knowledgeSearch: 2
            documentRetrieve: 1

  # Validate exact tool sequence
  - id: auth-flow
    expected_outcome: Agent follows auth sequence
    input_messages:
      - role: user
        content: Authenticate user
    execution:
      evaluators:
        - name: auth-sequence
          type: tool_trajectory
          mode: exact
          expected:
            - tool: checkCredentials
            - tool: generateToken
```

## Static Trace Evaluation

Evaluate pre-existing trace files without running an agent.

```yaml
description: Static trace evaluation
execution:
  target: static_trace

evalcases:
  - id: validate-trace-file
    expected_outcome: Trace contains required steps
    input_messages:
      - role: user
        content: Analyze trace
    execution:
      evaluators:
        - name: trace-check
          type: tool_trajectory
          mode: in_order
          expected:
            - tool: webSearch
            - tool: readFile
```

## Multi-Turn Conversation (Single Eval Case)

```yaml
description: Multi-turn debugging session with clarifying questions
execution:
  target: default

evalcases:
  - id: debug-with-clarification
    expected_outcome: |-
      Assistant conducts a multi-turn debugging session, asking clarification
      questions when needed, correctly diagnosing the bug, and proposing a clear
      fix with rationale.
    
    input_messages:
      - role: system
        content: You are an expert debugging assistant who reasons step by step, asks clarifying questions, and explains fixes clearly.
      - role: user
        content: |-
          I'm getting an off-by-one error in this function, but I can't see why:

          ```python
          def get_items(items):
              result = []
              for i in range(len(items) - 1):
                  result.append(items[i])
              return result
          ```

          Sometimes the last element is missing. Can you help debug this?
      - role: assistant
        content: |-
          I can help debug this. Before I propose a fix, could you tell me:
          - What output you expect for an example input list
          - What output you actually get
      - role: user
        content: |-
          For `[1, 2, 3, 4]` I expect `[1, 2, 3, 4]`, but I get `[1, 2, 3]`.
    
    expected_messages:
      - role: assistant
        content: |-
          You have an off-by-one error in your loop bounds.
          You're iterating with `range(len(items) - 1)`, which stops before the last index.
          To include all items, you can either:
          - Use `range(len(items))`, or
          - Iterate directly over the list: `for item in items:`
          
          Here's a corrected version:

          ```python
          def get_items(items):
              result = []
              for item in items:
                  result.append(item)
              return result
          ```
```

## Batch CLI Evaluation

Evaluate external batch runners that process all evalcases in one invocation.

```yaml
description: Batch CLI demo (AML screening)
execution:
  target: batch_cli

evalcases:
  - id: aml-001
    expected_outcome: |-
      Batch runner returns JSON with decision=CLEAR.

    expected_messages:
      - role: assistant
        content:
          decision: CLEAR

    input_messages:
      - role: system
        content: You are a deterministic AML screening batch checker.
      - role: user
        content:
          request:
            type: aml_screening_check
            jurisdiction: AU
            effective_date: 2025-01-01
          row:
            id: aml-001
            customer_name: Example Customer A
            origin_country: NZ
            destination_country: AU
            transaction_type: INTERNATIONAL_TRANSFER
            amount: 5000
            currency: USD

    execution:
      evaluators:
        - name: decision-check
          type: code_judge
          script: bun run ./scripts/check-batch-cli-output.ts
          cwd: .

  - id: aml-002
    expected_outcome: |-
      Batch runner returns JSON with decision=REVIEW.

    expected_messages:
      - role: assistant
        content:
          decision: REVIEW

    input_messages:
      - role: system
        content: You are a deterministic AML screening batch checker.
      - role: user
        content:
          request:
            type: aml_screening_check
            jurisdiction: AU
            effective_date: 2025-01-01
          row:
            id: aml-002
            customer_name: Example Customer B
            origin_country: IR
            destination_country: AU
            transaction_type: INTERNATIONAL_TRANSFER
            amount: 2000
            currency: USD

    execution:
      evaluators:
        - name: decision-check
          type: code_judge
          script: bun run ./scripts/check-batch-cli-output.ts
          cwd: .
```

### Batch CLI Pattern Notes
- **execution.target: batch_cli** - Configure CLI provider with `provider_batching: true`
- **Batch runner** - Reads eval YAML via `--eval` flag, outputs JSONL keyed by `id`
- **Structured input** - Put data in `user.content` as objects for runner to extract
- **Structured expected** - Use `expected_messages.content` with object fields
- **Per-case evaluators** - Each evalcase has its own evaluator to validate output

## Notes on Examples

### File Path Conventions
- **Absolute paths** (start with `/`): Resolved from repository root
  - Example: `/prompts/guidelines.md` → `<repo_root>/prompts/guidelines.md`
- **Relative paths** (start with `./` or `../`): Resolved from eval file directory
  - Example: `../../prompts/file.md` → Two directories up, then into prompts/

### expected_outcome Writing Tips
- Be specific about what success looks like
- Mention key elements that must be present
- For classification tasks, specify the expected category
- For reasoning tasks, describe the thought process expected

### Expected Messages
- Show the pattern, not rigid templates
- Allow for natural language variation
- Focus on semantic correctness over exact matching
- Evaluators will handle the actual validation
