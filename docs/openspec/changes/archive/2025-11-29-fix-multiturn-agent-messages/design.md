## Context

Multi-turn conversations require proper formatting to maintain context and turn boundaries when sent to language models. The current implementation flattens all messages into a single `question` string, losing the structural information about who said what when.

## Goals / Non-Goals

**Goals:**
- Enable testing of multi-turn conversational scenarios
- Preserve backward compatibility with existing single-turn evaluations
- Use clear, human-readable formatting for conversation turns
- Support file attachments within specific conversation turns

**Non-Goals:**
- Changing the underlying message schema in YAML files
- Modifying how LLM providers receive messages (providers still get the formatted string)
- Supporting complex threading or branching conversations
- Special handling for different provider message formats (keep using the unified `question` field)

## Decisions

### Decision: Use inline turn markers in the question field

**What:** Format multi-turn conversations using role markers like `[User]:`, `[Assistant]:`, `[System]:` within the `question` string.

**Why:** 
- Maintains compatibility with existing request structure (`raw_request.question`)
- Human-readable format makes debugging easier
- Works with all providers without provider-specific formatting
- Simple to implement - just string formatting

**Alternatives considered:**
- Structured message array: Would require changes to all providers and break existing code
- JSON-encoded messages: Less readable, harder to debug
- XML-style tags: More verbose, no real benefit over brackets
- TOON format (https://github.com/toon-format/toon): Token-efficient format designed for LLM input/output
  - **Format example:**
    ```yaml
    - system: You are a debugging expert.
    - user: I have a bug in my code.
    - assistant: Can you share the code?
    ```
  - **What TOON is for:** Encoding data for LLM consumption (reducing token costs in prompts)
  - **Why not use TOON here:** The `question` field is a string for logging/debugging, not LLM input optimization
  - **Future consideration:** TOON could be valuable for encoding eval **result files** when feeding conversation logs back to LLMs for analysis, but not for the runtime `question` string
  - **Verdict:** `[Role]:` markers are more natural for string-based logging; TOON solves a different problem

### Decision: Extract `.instructions.md` files to guidelines, embed others inline

**What:** Files ending in `.instructions.md` go to `guidelines` field; other files are embedded within their respective turn in the `question` field.

**Why:**
- Maintains existing behavior for instruction files (they're treated as system-level context)
- Other files (examples, snippets) are turn-specific and should appear in context
- Aligns with current eval schema design

### Decision: Smart role marker detection based on conversational structure

**What:** Use role markers only when there's actual conversational structure:
- If `input_messages` contains any non-user messages (assistant, tool, etc.) → use role markers
- If multiple messages have text content (after extracting `.instructions.md` to guidelines) → use role markers
- Otherwise (e.g., system file + user text, or simple system text + user text) → use flat format

**Why:**
- Zero breaking changes for existing evaluations
- Handles common pattern of system file attachment + user message cleanly (no unnecessary markers)
- Role markers only appear when they add clarity (multi-turn conversations)
- Simple conditional logic based on observable message structure

**Alternatives considered:**
- Always use turn markers: Would change output for all existing evals and add noise to simple cases
- Turn count only: Doesn't handle the system-file-only case elegantly
- New field for multi-turn: Adds complexity without clear benefit

### Decision: Preserve role markers in evaluator prompts

**What:** When building evaluator prompts, use the same formatted `question` (with or without role markers) that was sent to the candidate LLM.

**Why:**
- Evaluator needs to understand the conversational context to judge appropriateness of responses
- Multi-turn conversations appear as confusing blobs without role markers
- Ensures evaluator sees exactly what the candidate LLM received
- Maintains consistency between candidate and evaluator contexts

**Alternatives considered:**
- Strip role markers for evaluator: Would lose critical context about conversation flow
- Separate formatting for evaluator: Adds complexity and could cause evaluation mismatches
- Flatten all conversations for evaluator: Breaks evaluation of multi-turn behavior

## Formatting Examples

### Single-turn (existing behavior, unchanged)

```yaml
input_messages:
  - role: system
    content: You are a helpful assistant.
  - role: user
    content: What is 2+2?
```

**Formatted question:**
```
You are a helpful assistant.

What is 2+2?
```

### System file attachment + user message (no role markers)

```yaml
input_messages:
  - role: system
    content:
      - type: file
        value: coding-guidelines.instructions.md
  - role: user
    content: Please review this code.
```

**Formatted question:**
```
Please review this code.
```

**Formatted guidelines:**
```
=== coding-guidelines.instructions.md ===
[file content]
```

### Multi-turn (new behavior)

```yaml
input_messages:
  - role: system
    content: You are a debugging expert.
  - role: user
    content: I have a bug in my code.
  - role: assistant
    content: Can you share the code?
  - role: user
    content: Here it is: [code snippet]
```

**Formatted question:**
```
[System]:
You are a debugging expert.

[User]:
I have a bug in my code.

[Assistant]:
Can you share the code?

[User]:
Here it is: [code snippet]
```

## Risks / Trade-offs

**Risk:** Turn markers could confuse models that aren't trained on this format
- **Mitigation:** Use simple, natural markers like `[User]:` that most models handle well. Test with common providers.

**Trade-off:** String-based formatting vs. native message arrays
- **Chosen:** String formatting for simplicity and compatibility
- **Cost:** Some providers have native message support we're not using
- **Benefit:** Unified interface, easier testing, works with all providers

## Migration Plan

1. Implement turn detection logic in request builder
2. Add formatting function with turn markers
3. Test with multi-turn example in `example-eval.yaml`
4. Validate existing single-turn evals still pass (regression test)
5. Document the formatting convention in eval schema documentation

**Rollback:** If issues arise, the change is isolated to request formatting. Reverting to flat format is straightforward.

## Open Questions

- Should we support custom turn marker formats (e.g., `User:` vs `[User]:`)?
  - **Recommendation:** Start with `[Role]:` format, add customization only if needed
- Should system messages have a marker or be unmarked?
  - **Recommendation:** Use `[System]:` for consistency when multiple turns exist, keep unmarked for single-turn backward compatibility

## Future Enhancements

### TOON Format for Eval Results (Deferred)

The TOON (Turn-Oriented Object Notation) format (https://github.com/toon-format/toon) could be useful for **eval result files** when conversation logs need to be fed back to LLMs for analysis or review.

**TOON's Purpose:**
- Token-efficient encoding of structured data **for LLM consumption**
- Reduces token costs when feeding data into LLM prompts
- Human-readable format that LLMs can parse reliably

**Where TOON Could Help in AgentV:**

```yaml
# Current eval results format
raw_request:
  question: |-
    [System]:
    You are a debugging expert.
    
    [User]:
    I have a bug in my code.
    
    [Assistant]:
    Can you share the code?

# Potential TOON format for results (more compact for LLM analysis)
raw_request:
  question_toon: |-
    - system: You are a debugging expert.
    - user: I have a bug in my code.
    - assistant: Can you share the code?
```

**Use Case:**
When using LLMs to analyze evaluation results (meta-evaluation, pattern detection, result summarization), encoding conversations in TOON would:
- Reduce token costs significantly
- Maintain full conversation structure
- Be easier for analysis LLMs to parse than `[Role]:` text format

**Why NOT use TOON for runtime `question` field:**
- Runtime `question` is for logging/debugging (human consumption)
- `[Role]:` markers are more natural in plain text strings
- TOON is optimized for LLM input, not human-readable logs

**Migration Path (when needed):**
1. Add optional TOON encoder for conversation logs in result files
2. Keep `[Role]:` format as default for backward compatibility
3. Allow opt-in TOON output via config flag for users doing LLM-based result analysis
4. Document token savings benefits for meta-evaluation workflows

**Decision:** Defer TOON integration. The `[Role]:` marker format serves current logging needs well. Consider TOON only if/when users need to feed large volumes of eval results back into LLMs for analysis.
