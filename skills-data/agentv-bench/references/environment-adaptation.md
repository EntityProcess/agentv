# Environment Adaptation

Provider-specific notes, CI/headless behavior, and fallback strategies for environments
with limited capabilities.

## CI/Headless Mode

Skip interactive prompts. Exit with pass/fail status code. Always generate artifacts for
downstream consumption.

## No Subagents Available (e.g., Claude.ai)

Run test cases serially. Skip blind comparison. Present results directly in conversation —
for each test case, show the prompt and output. Ask for feedback inline. Skip benchmarking
(it relies on baseline comparisons that aren't meaningful without subagents).

## Provider-Specific Notes

- **Copilot CLI**: Uses ACP protocol via `copilot --acp --stdio`
- **Claude SDK**: Requires `@anthropic-ai/claude-agent-sdk` installed
- **Codex**: Supports skills via `.agents/` or `.codex/` folders. Emits `command_execution`
  and `file_change` tool calls.
- **Custom CLI**: Needs `command` and output file pattern in target config
- **Target config**: Uses `${{ ENV_VAR }}` syntax (not `${ENV_VAR}`) for API keys

**Note**: "Description Optimization" (see `references/description-optimization.md`) applies
to any platform with skill-discovery mechanisms. All listed providers support skills.

## Unsupported Providers: Use a Code-Grader

The built-in `skill-trigger` grader covers Claude, Copilot, Pi, Codex and VS Code out
of the box. For providers with different tool-call formats, write a code-grader that inspects
the agent's transcript messages or tool call trace.

A code-grader receives the full evaluation context including the final `output` string,
transcript `messages`, and structured `trace`. Inspect `messages` or `trace.events` for
tool calls; reserve `output` for final-answer text checks.

```yaml
# Example: code-grader for Codex skill-trigger detection
tests:
  - id: should-trigger-codex
    input: "Analyze this CSV file"
    assertions:
      - type: code-grader
        command: [bun, run, ./judges/codex-skill-trigger.ts]
```

```typescript
// judges/codex-skill-trigger.ts
import { defineCodeGrader } from '@agentv/sdk';

export default defineCodeGrader(({ messages }) => {
  const skillName = 'csv-analyzer';
  const toolCalls = messages.flatMap((msg) => msg.toolCalls ?? []);
  const firstTool = toolCalls[0];

  if (!firstTool) {
    return { score: 0, assertions: [{ text: 'No tool calls recorded', passed: false }] };
  }

  // Codex reads skill files via shell commands
  if (firstTool.tool === 'command_execution') {
    const cmd = String(firstTool.input ?? '');
    if (cmd.includes(skillName)) {
      return {
        score: 1,
        assertions: [
          { text: `Skill "${skillName}" triggered via command`, passed: true, evidence: cmd },
        ],
      };
    }
  }

  // Check if skill file was read via file_change or other tools
  if (firstTool.tool === 'file_change') {
    const path = String((firstTool.input as Record<string, unknown>)?.path ?? '');
    if (path.includes(skillName)) {
      return {
        score: 1,
        assertions: [{ text: 'Skill file accessed', passed: true, evidence: path }],
      };
    }
  }

  return {
    score: 0,
    assertions: [
      {
        text: `First tool was not a skill invocation for "${skillName}"`,
        passed: false,
        evidence: firstTool.tool,
      },
    ],
  };
});
```

This approach is more flexible than config overrides — you can match any tool-call pattern,
check multiple fields, and add provider-specific logic as needed.
