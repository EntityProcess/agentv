# Example Eval Files

This document contains complete examples of well-structured eval files demonstrating various AgentV patterns and best practices.

## Basic Example: Simple Q&A Eval

```yaml
$schema: agentv-eval-v2
description: Basic arithmetic evaluation
target: default

evalcases:
  - id: simple-addition
    outcome: Correctly calculates 2+2
    
    input_messages:
      - role: user
        content: What is 2 + 2?
    
    expected_messages:
      - role: assistant
        content: "4"
```

## Code Review with File References

```yaml
$schema: agentv-eval-v2
description: Code review with guidelines
target: azure_base

evalcases:
  - id: code-review-basic
    outcome: Assistant provides helpful code analysis with security considerations
    
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
$schema: agentv-eval-v2
description: JSON generation with validation
target: default

evalcases:
  - id: json-generation-with-validation
    outcome: Generates valid JSON with required fields
    
    execution:
      evaluators:
        - name: json_format_validator
          type: code
          script: uv run validate_json.py
          cwd: ./evaluators
        - name: content_evaluator
          type: llm_judge
          prompt: ./judges/semantic_correctness.md
          model: gpt-5-chat
    
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

## Conversation Threading

```yaml
$schema: agentv-eval-v2
description: Multi-turn conversation for iterative code development
target: default

evalcases:
  - id: create-class
    conversation_id: python-dev-session
    outcome: Creates a basic User class
    
    input_messages:
      - role: user
        content: Create a Python User class with name and email attributes
    
    expected_messages:
      - role: assistant
        content: |-
          ```python
          class User:
              def __init__(self, name, email):
                  self.name = name
                  self.email = email
          ```
  
  - id: add-validation
    conversation_id: python-dev-session
    outcome: Adds email validation to the existing class
    
    input_messages:
      - role: user
        content: Add email validation to the User class
    
    expected_messages:
      - role: assistant
        content: |-
          ```python
          import re
          
          class User:
              def __init__(self, name, email):
                  self.name = name
                  self.email = self._validate_email(email)
              
              def _validate_email(self, email):
                  pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
                  if not re.match(pattern, email):
                      raise ValueError(f"Invalid email: {email}")
                  return email
          ```
  
  - id: add-repr
    conversation_id: python-dev-session
    outcome: Adds __repr__ method for better debugging
    
    input_messages:
      - role: user
        content: Add a __repr__ method to the class
    
    expected_messages:
      - role: assistant
        content: |-
          ```python
          def __repr__(self):
              return f"User(name='{self.name}', email='{self.email}')"
          ```
```

## Advanced: Per-Case Target Override

```yaml
$schema: agentv-eval-v2
description: Cross-platform testing with different targets
target: azure_base

evalcases:
  - id: azure-test
    outcome: Tests with Azure OpenAI (uses file-level default target)
    
    input_messages:
      - role: user
        content: Explain async/await in Python
    
    expected_messages:
      - role: assistant
        content: "async/await is Python's syntax for asynchronous programming..."
  
  - id: vscode-test
    outcome: Tests with VS Code Copilot
    
    execution:
      target: vscode_projectx
    
    input_messages:
      - role: user
        content:
          - type: text
            value: Refactor this code to use async/await
          - type: file
            value: /code-samples/sync_code.py
    
    expected_messages:
      - role: assistant
        content: "async def fetch_data():\n    await ..."
```

## Complex Real-World Example: CargoWise Triage

```yaml
$schema: agentv-eval-v2
description: CargoWise criticality rating (CR1-CR9) classification eval
target: default

evalcases:
  - id: cr-global-outage
    conversation_id: cargowise-triage
    
    outcome: |
      Assistant correctly classifies as 'CR1' for complete system inaccessibility.
      Reasoning should emphasize 'any user on any workstation' and lack of access.
    
    execution:
      evaluators:
        - name: json_format_validator
          type: code
          script: uv run validate_output.py
        - name: content_evaluator
          type: llm_judge
    
    input_messages:
      - role: user
        content:
          - type: file
            value: ../../prompts/cw-criticality-rating.prompt.md
          - type: text
            value: |-
              Classify this CargoWise ticket:
              
              Ticket: Entire system down, no users can log in from any device
              Impact: All operations halted
              Scope: Global
              Signals: Error: "Server unreachable", no recent changes reported
    
    expected_messages:
      - role: assistant
        content: |-
          {
            "criticalityRating": "CR1",
            "reasoning": "Step 1: Issue prevents access to the entire application suite. 
            Step 2: Affects any user on any workstation. Step 3: Matches CR1 definition 
            exactly—no partial access or workarounds mentioned."
          }
  
  - id: cr-module-inaccessible
    conversation_id: cargowise-triage
    
    outcome: |
      Assistant correctly classifies as 'CR2' for module-wide inaccessibility.
      Reasoning should distinguish from CR1 by noting it's limited to one module.
    
    execution:
      evaluators:
        - name: json_format_validator
          type: code
          script: uv run validate_output.py
        - name: content_evaluator
          type: llm_judge
    
    input_messages:
      - role: user
        content:
          - type: file
            value: ../../prompts/cw-criticality-rating.prompt.md
          - type: text
            value: |-
              Classify this CargoWise ticket:
              
              Ticket: Customs module inaccessible for all users
              Impact: Customs declarations blocked
              Scope: Module-wide
              Signals: "Module not found" error, other modules working
    
    expected_messages:
      - role: assistant
        content: |-
          {
            "criticalityRating": "CR2",
            "reasoning": "Step 1: Issue affects an entire module (Customs). 
            Step 2: No access for any user/workstation. Step 3: Does not impact 
            the full suite, so CR2 over CR1."
          }
```

## Notes on Examples

### File Path Conventions
- **Absolute paths** (start with `/`): Resolved from repository root
  - Example: `/prompts/guidelines.md` → `<repo_root>/prompts/guidelines.md`
- **Relative paths** (start with `./` or `../`): Resolved from eval file directory
  - Example: `../../prompts/file.md` → Two directories up, then into prompts/

### Outcome Writing Tips
- Be specific about what success looks like
- Mention key elements that must be present
- For classification tasks, specify the expected category
- For reasoning tasks, describe the thought process expected

### Expected Messages
- Show the pattern, not rigid templates
- Allow for natural language variation
- Focus on semantic correctness over exact matching
- Evaluators will handle the actual validation
