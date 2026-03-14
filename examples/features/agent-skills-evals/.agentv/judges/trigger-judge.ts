#!/usr/bin/env bun
/**
 * trigger-judge: detects whether the agent invoked a named Claude Code skill.
 *
 * Usage in eval YAML:
 *   assert:
 *     - type: trigger-judge          # discovered from .agentv/judges/
 *       skill: my-skill-name         # passed via config
 *
 * Checks:
 *   - Skill tool call where args.skill matches the configured skill name
 *   - Read tool call loading a file from .claude/commands/ or .claude/skills/
 *     whose path contains the skill name
 */
import { defineCodeJudge } from '@agentv/eval';

export default defineCodeJudge(({ output, config }) => {
  const skillName = config?.skill as string | undefined;
  if (!skillName) {
    return { score: 0, misses: ['config.skill is required'], reasoning: 'No skill name configured' };
  }

  const allToolCalls = (output ?? []).flatMap((msg) => msg.toolCalls ?? []);

  // Check for Skill tool invocation
  const skillTrigger = allToolCalls.find(
    (tc) =>
      tc.tool === 'Skill' &&
      typeof tc.input === 'object' &&
      tc.input !== null &&
      String((tc.input as Record<string, unknown>).skill ?? '').toLowerCase().includes(skillName.toLowerCase()),
  );

  if (skillTrigger) {
    return {
      score: 1,
      hits: [`Skill tool invoked with skill="${(skillTrigger.input as Record<string, unknown>).skill}"`],
      reasoning: `Agent triggered skill "${skillName}"`,
    };
  }

  // Check for Read tool loading a skill file
  const readTrigger = allToolCalls.find((tc) => {
    if (tc.tool !== 'Read') return false;
    const filePath = String(
      (tc.input as Record<string, unknown> | null)?.file_path ??
        (tc.input as Record<string, unknown> | null)?.path ??
        '',
    ).toLowerCase();
    return (
      (filePath.includes('.claude/commands/') || filePath.includes('.claude/skills/')) &&
      filePath.includes(skillName.toLowerCase())
    );
  });

  if (readTrigger) {
    return {
      score: 1,
      hits: [`Read tool loaded skill file: ${(readTrigger.input as Record<string, unknown>)?.file_path ?? (readTrigger.input as Record<string, unknown>)?.path}`],
      reasoning: `Agent read skill "${skillName}" definition`,
    };
  }

  return {
    score: 0,
    misses: [`Skill "${skillName}" was not triggered`],
    reasoning: `No Skill or Read tool call matched "${skillName}"`,
  };
});
