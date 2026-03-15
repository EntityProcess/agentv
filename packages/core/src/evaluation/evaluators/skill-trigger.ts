/**
 * Built-in skill-trigger evaluator.
 *
 * Detects whether the agent invoked a named Claude Code skill as its first tool call.
 * Mirrors the post-hoc fallback detection in skill-creator's run_eval.py:
 *   - Only the FIRST tool call matters.
 *   - Skill tool: checks input.skill contains the skill name (case-sensitive substring).
 *   - Read tool: checks input.file_path contains the skill name (case-sensitive substring).
 *   - Any other tool as first call means the skill was not triggered.
 *   - Supports negative cases via should_trigger: false.
 */

import type { SkillTriggerEvaluatorConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

export class SkillTriggerEvaluator implements Evaluator {
  readonly kind = 'skill-trigger';

  private readonly config: SkillTriggerEvaluatorConfig;

  constructor(config: SkillTriggerEvaluatorConfig) {
    this.config = config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const skillName = this.config.skill;
    const shouldTrigger = this.config.should_trigger !== false; // default true

    // Flatten all tool calls across messages and take only the first one.
    // run_eval.py returns false as soon as a non-Skill/Read tool starts,
    // so only the first tool call is relevant.
    const firstTool = (context.output ?? []).flatMap((msg) => msg.toolCalls ?? [])[0];

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
        verdict: 'pass',
        hits: [
          shouldTrigger
            ? evidence || `Skill "${skillName}" triggered as expected`
            : `Skill "${skillName}" correctly did not trigger`,
        ],
        misses: [],
        expectedAspectCount: 1,
        reasoning: shouldTrigger ? 'Skill triggered correctly' : 'No false trigger',
      };
    }

    return {
      score: 0,
      verdict: 'fail',
      hits: [],
      misses: [
        shouldTrigger
          ? firstTool
            ? `First tool was "${firstTool.tool}" — not Skill/Read for "${skillName}"`
            : 'No tool calls recorded'
          : evidence || `Skill "${skillName}" triggered unexpectedly`,
      ],
      expectedAspectCount: 1,
      reasoning: shouldTrigger
        ? `Skill "${skillName}" was not triggered`
        : 'False trigger: skill fired when it should not have',
    };
  }
}
