---
"@agentv/core": major
"agentv": major
---

**BREAKING CHANGE**: Rename `expected_messages` evaluator type to `expected_tool_calls`

This is a breaking change that renames the evaluator type from `expected_messages` to `expected_tool_calls` to better reflect its purpose of validating tool calls against traces.

**Migration:**
Update your YAML files to use the new evaluator type:

Before:
```yaml
execution:
  evaluators:
    - name: my-validator
      type: expected_messages
```

After:
```yaml
execution:
  evaluators:
    - name: my-validator
      type: expected_tool_calls
```

**Note:** The `expected_messages` field in eval cases remains unchanged - only the evaluator type string changes.

If you use the old type `expected_messages`, you will get an error message suggesting the new type:
`Unknown evaluator type 'expected_messages'. Did you mean 'expected_tool_calls'?`
