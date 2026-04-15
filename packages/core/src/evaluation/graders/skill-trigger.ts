/**
 * Built-in skill-trigger evaluator.
 *
 * Detects whether the agent invoked a named skill during a session.
 * Works with canonical tool names produced by normalizeToolCall() — no
 * provider-specific matching logic needed.
 *
 * Detection logic:
 *   - Scans ALL tool calls (not just the first) for skill invocation evidence.
 *   - Skill tool: checks `tool === 'Skill'` and `input.skill` contains the skill name.
 *   - Read tool: checks `tool === 'Read'` and `input.file_path` contains a skills/ path.
 *   - Fallback: checks tool output for skill file path references.
 *   - Supports negative cases via should_trigger: false.
 *
 * Prerequisites:
 *   All providers and import parsers must call normalizeToolCall() when
 *   constructing ToolCall objects. This ensures canonical tool names
 *   ("Skill", "Read", "Write", "Edit", "Bash") and canonical input field
 *   names (input.skill, input.file_path) regardless of provider.
 */

import type { SkillTriggerGraderConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

export class SkillTriggerGrader implements Grader {
  readonly kind = 'skill-trigger';

  private readonly config: SkillTriggerGraderConfig;

  constructor(config: SkillTriggerGraderConfig) {
    this.config = config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const skillName = this.config.skill;
    const shouldTrigger = this.config.should_trigger !== false;

    const allToolCalls = (context.output ?? []).flatMap((msg) => msg.toolCalls ?? []);

    let triggered = false;
    let evidence = '';

    for (const toolCall of allToolCalls) {
      const toolName = toolCall.tool ?? '';
      const input = (toolCall.input ?? {}) as Record<string, unknown>;

      if (toolName === 'Skill') {
        const skillArg = String(input.skill ?? '');
        if (skillArg.includes(skillName)) {
          triggered = true;
          evidence = `Skill tool invoked with skill="${skillArg}"`;
          break;
        }
      } else if (toolName === 'Read') {
        const filePath = String(input.file_path ?? '');
        if (filePath.includes(`skills/${skillName}/`)) {
          triggered = true;
          evidence = `Read tool loaded skill file: ${filePath}`;
          break;
        }
      }

      // Fallback: check if a tool's output contains a skill file path.
      if (!triggered && toolCall.output != null) {
        const outputStr =
          typeof toolCall.output === 'string' ? toolCall.output : JSON.stringify(toolCall.output);
        if (outputStr.includes(`skills/${skillName}/`)) {
          triggered = true;
          evidence = `Tool "${toolName}" output referenced skill file for "${skillName}"`;
          break;
        }
      }
    }

    const pass = triggered === shouldTrigger;

    if (pass) {
      return {
        score: 1,
        verdict: 'pass',
        assertions: [
          {
            text: shouldTrigger
              ? evidence || `Skill "${skillName}" triggered as expected`
              : `Skill "${skillName}" correctly did not trigger`,
            passed: true,
          },
        ],
        expectedAspectCount: 1,
      };
    }

    return {
      score: 0,
      verdict: 'fail',
      assertions: [
        {
          text: shouldTrigger
            ? allToolCalls.length > 0
              ? `Skill "${skillName}" not found in ${allToolCalls.length} tool call(s)`
              : 'No tool calls recorded'
            : evidence || `Skill "${skillName}" triggered unexpectedly`,
          passed: false,
        },
      ],
      expectedAspectCount: 1,
    };
  }
}
