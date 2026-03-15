#!/usr/bin/env bun
/**
 * trigger-judge: detects whether the agent invoked a named Claude Code skill.
 *
 * Mirrors the post-hoc fallback detection in skill-creator's run_eval.py:
 *   - Only the FIRST tool call matters. Any non-Skill/Read tool as the first
 *     call means the skill was not triggered (mirrors run_eval.py's early-exit).
 *   - Skill tool: checks input.skill contains the skill name (case-sensitive).
 *   - Read tool: checks input.file_path contains the skill name (case-sensitive).
 *   - Supports negative cases via should_trigger: false.
 *
 * Usage in eval YAML:
 *   assert:
 *     - type: trigger-judge          # discovered from .agentv/judges/
 *       skill: my-skill-name         # required: exact name as installed in .claude/commands/
 *       should_trigger: true         # optional: expected behaviour (default: true)
 *
 * Positive case (should_trigger: true):  passes when skill fires.
 * Negative case (should_trigger: false): passes when skill does NOT fire.
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ output, config }) => {
  const skillName = config?.skill as string | undefined;
  const shouldTrigger = (config?.should_trigger ?? true) as boolean;

  if (!skillName) {
    return {
      score: 0,
      misses: ['config.skill is required'],
      reasoning: 'No skill name configured',
    };
  }

  // Flatten all tool calls across messages and take only the first one.
  // run_eval.py returns false as soon as a non-Skill/Read tool starts, so
  // only the first tool call is relevant.
  const firstTool = (output ?? []).flatMap((msg) => msg.toolCalls ?? [])[0];

  let triggered = false;
  let evidence = '';

  if (firstTool) {
    const input = (firstTool.input ?? {}) as Record<string, unknown>;

    if (firstTool.tool === 'Skill') {
      const skillArg = String(input.skill ?? '');
      if (skillArg.includes(skillName)) {
        triggered = true;
        evidence = `Skill tool invoked with skill="${skillArg}"`;
      }
    } else if (firstTool.tool === 'Read') {
      const filePath = String(input.file_path ?? '');
      if (filePath.includes(skillName)) {
        triggered = true;
        evidence = `Read tool loaded skill file: ${filePath}`;
      }
    }
    // Any other tool as first call: triggered remains false
  }

  const pass = triggered === shouldTrigger;

  if (pass) {
    return {
      score: 1,
      hits: [
        shouldTrigger
          ? evidence || `Skill "${skillName}" triggered as expected`
          : `Skill "${skillName}" correctly did not trigger`,
      ],
      reasoning: shouldTrigger ? 'Skill triggered correctly' : 'No false trigger',
    };
  }

  return {
    score: 0,
    misses: [
      shouldTrigger
        ? firstTool
          ? `First tool was "${firstTool.tool}" — not Skill/Read for "${skillName}"`
          : `No tool calls recorded`
        : evidence || `Skill "${skillName}" triggered unexpectedly`,
    ],
    reasoning: shouldTrigger
      ? `Skill "${skillName}" was not triggered`
      : `False trigger: skill fired when it should not have`,
  };
});
