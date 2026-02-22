# Example: Markdown Transcript Input

## Input

```
User: What are the SOLID principles in software engineering?
Assistant: The SOLID principles are five design principles for object-oriented programming:

1. **Single Responsibility** — A class should have only one reason to change
2. **Open/Closed** — Open for extension, closed for modification
3. **Liskov Substitution** — Subtypes must be substitutable for their base types
4. **Interface Segregation** — Prefer small, specific interfaces over large ones
5. **Dependency Inversion** — Depend on abstractions, not concretions

User: Can you give me an example of the Single Responsibility Principle?
Assistant: Sure! Instead of a class that handles both user authentication and email sending, split them:

Bad: `UserService` handles login, registration, AND sends welcome emails.
Good: `AuthService` handles login/registration. `EmailService` handles sending emails.

Each class has one job, making them easier to test and maintain.

User: What's the difference between an interface and an abstract class?
Assistant: Key differences:

- **Interface**: Defines a contract (method signatures only). A class can implement multiple interfaces. No state.
- **Abstract class**: Can have both abstract and concrete methods. A class can extend only one. Can hold state.

Use interfaces for "can-do" relationships (e.g., `Serializable`). Use abstract classes for "is-a" relationships with shared behavior (e.g., `Animal` base class).
```

## Output

```yaml
description: "Software engineering concepts — SOLID principles and OOP"

tests:
  - id: solid-principles-overview
    criteria: "List and briefly explain all five SOLID principles"
    input: "What are the SOLID principles in software engineering?"
    expected_output: |
      The SOLID principles are five design principles for object-oriented programming:

      1. **Single Responsibility** — A class should have only one reason to change
      2. **Open/Closed** — Open for extension, closed for modification
      3. **Liskov Substitution** — Subtypes must be substitutable for their base types
      4. **Interface Segregation** — Prefer small, specific interfaces over large ones
      5. **Dependency Inversion** — Depend on abstractions, not concretions
    assert:
      - type: rubrics
        criteria:
          - Lists all five SOLID principles by name
          - Provides a concise explanation for each principle
          - Explanations are technically accurate

  - id: srp-example
    criteria: "Provide a concrete example of the Single Responsibility Principle"
    input:
      - role: user
        content: "What are the SOLID principles in software engineering?"
      - role: assistant
        content: "The SOLID principles are five design principles..."
      - role: user
        content: "Can you give me an example of the Single Responsibility Principle?"
    expected_output: |
      Sure! Instead of a class that handles both user authentication and email sending, split them:

      Bad: `UserService` handles login, registration, AND sends welcome emails.
      Good: `AuthService` handles login/registration. `EmailService` handles sending emails.

      Each class has one job, making them easier to test and maintain.
    assert:
      - type: rubrics
        criteria:
          - Shows a bad example that violates SRP
          - Shows a good example that follows SRP
          - Explains why the separation is beneficial

  - id: interface-vs-abstract-class
    criteria: "Explain the difference between interfaces and abstract classes"
    input: "What's the difference between an interface and an abstract class?"
    expected_output: |
      Key differences:

      - **Interface**: Defines a contract (method signatures only). A class can implement multiple interfaces. No state.
      - **Abstract class**: Can have both abstract and concrete methods. A class can extend only one. Can hold state.

      Use interfaces for "can-do" relationships (e.g., `Serializable`). Use abstract classes for "is-a" relationships with shared behavior (e.g., `Animal` base class).
    assert:
      - type: rubrics
        criteria:
          - Correctly distinguishes interfaces from abstract classes
          - Mentions multiple inheritance support for interfaces
          - Provides guidance on when to use each

# Suggested additional evaluators:
# assert:
#   - name: quality
#     type: llm_judge
#     prompt: ./prompts/quality.md
```
