import type { ToolCall } from '../providers/types.js';
import type { TriggerJudgeEvaluatorConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

export type { TriggerJudgeEvaluatorConfig };

/**
 * TriggerJudgeEvaluator checks whether the agent invoked a named skill during
 * its execution. It scans the response tool calls for:
 *
 * 1. A `Skill` tool call where args.skill contains the skill name
 * 2. A `Read` tool call where the file_path contains the skill name and a
 *    skill-related directory (.claude/commands/ or .claude/skills/)
 *
 * This enables post-hoc verification that the agent used the correct skill
 * rather than re-implementing the logic inline.
 */
export class TriggerJudgeEvaluator implements Evaluator {
  readonly kind = 'trigger-judge';

  private readonly config: TriggerJudgeEvaluatorConfig;

  constructor(config: TriggerJudgeEvaluatorConfig) {
    this.config = config;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const skillName = this.config.skill;
    const allToolCalls = collectAllToolCalls(context.output);

    if (allToolCalls.length === 0) {
      return {
        score: 0,
        verdict: 'fail',
        hits: [],
        misses: [`No tool calls found — skill '${skillName}' was not triggered`],
        expectedAspectCount: 1,
        reasoning: `No tool calls were made, so skill '${skillName}' was not invoked.`,
      };
    }

    // Check for Skill tool call with matching skill name
    const skillToolCall = findSkillToolCall(allToolCalls, skillName);
    if (skillToolCall) {
      const argsStr = JSON.stringify(skillToolCall.input ?? {});
      return {
        score: 1,
        verdict: 'pass',
        hits: [`Skill tool called with skill='${skillName}' (args: ${argsStr})`],
        misses: [],
        expectedAspectCount: 1,
        reasoning: `The agent invoked the '${skillName}' skill via the Skill tool.`,
      };
    }

    // Check for Read tool call loading a skill file
    const readToolCall = findSkillReadToolCall(allToolCalls, skillName);
    if (readToolCall) {
      const filePath =
        typeof (readToolCall.input as Record<string, unknown> | undefined)?.file_path === 'string'
          ? (readToolCall.input as Record<string, unknown>).file_path
          : String(readToolCall.input ?? '');
      return {
        score: 1,
        verdict: 'pass',
        hits: [`Skill file read: ${filePath}`],
        misses: [],
        expectedAspectCount: 1,
        reasoning: `The agent read the skill file for '${skillName}' at '${filePath}'.`,
      };
    }

    return {
      score: 0,
      verdict: 'fail',
      hits: [],
      misses: [`Skill '${skillName}' was not triggered (${allToolCalls.length} tool calls made)`],
      expectedAspectCount: 1,
      reasoning: `The agent made ${allToolCalls.length} tool call(s) but did not invoke skill '${skillName}'.`,
    };
  }
}

/**
 * Collect all tool calls from all output messages.
 */
function collectAllToolCalls(
  output: readonly import('../providers/types.js').Message[] | undefined,
): readonly ToolCall[] {
  if (!output || output.length === 0) {
    return [];
  }
  const result: ToolCall[] = [];
  for (const message of output) {
    if (message.toolCalls && message.toolCalls.length > 0) {
      result.push(...message.toolCalls);
    }
  }
  return result;
}

/**
 * Find a Skill tool call where args.skill matches (exact or contains) the skill name.
 */
function findSkillToolCall(
  toolCalls: readonly ToolCall[],
  skillName: string,
): ToolCall | undefined {
  const lowerSkill = skillName.toLowerCase();
  for (const tc of toolCalls) {
    if (tc.tool !== 'Skill') continue;
    const args = tc.input as Record<string, unknown> | undefined;
    if (!args) continue;
    const argSkill = args.skill ?? args.name ?? args.args;
    if (typeof argSkill === 'string') {
      const lowerArgSkill = argSkill.toLowerCase();
      if (lowerArgSkill === lowerSkill || lowerArgSkill.includes(lowerSkill)) {
        return tc;
      }
    }
  }
  return undefined;
}

/**
 * Find a Read tool call where the file_path contains the skill name and a
 * known skill directory (.claude/commands/ or .claude/skills/).
 */
function findSkillReadToolCall(
  toolCalls: readonly ToolCall[],
  skillName: string,
): ToolCall | undefined {
  const lowerSkill = skillName.toLowerCase();
  const skillDirs = ['.claude/commands/', '.claude/skills/'];
  for (const tc of toolCalls) {
    if (tc.tool !== 'Read') continue;
    const args = tc.input as Record<string, unknown> | undefined;
    if (!args) continue;
    const filePath = typeof args.file_path === 'string' ? args.file_path.toLowerCase() : '';
    if (!filePath) continue;
    const inSkillDir = skillDirs.some((dir) => filePath.includes(dir));
    if (inSkillDir && filePath.includes(lowerSkill)) {
      return tc;
    }
  }
  return undefined;
}
