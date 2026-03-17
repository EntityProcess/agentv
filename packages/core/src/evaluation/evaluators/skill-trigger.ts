/**
 * Built-in skill-trigger evaluator.
 *
 * Detects whether the agent invoked a named skill as its first tool call.
 * Supports multiple provider kinds via static tool-name mappings.
 * For providers not covered here, use a code-grader instead.
 *
 * Detection logic:
 *   - Only the FIRST tool call matters.
 *   - Skill tool: checks input.[skillInputField] contains the skill name (case-sensitive substring).
 *   - Read tool: checks input.[readInputField] contains the skill name (case-sensitive substring).
 *   - Any other tool as first call means the skill was not triggered.
 *   - Supports negative cases via should_trigger: false.
 *
 * To add a new provider:
 *   1. Create a ToolMatcher with the provider's tool names and input fields.
 *   2. Add entries to PROVIDER_TOOL_SEMANTICS mapping the provider kind(s) to the matcher.
 *   3. If the provider's tool-call format doesn't fit the ToolMatcher model, use a code-grader instead.
 */

import type { ProviderKind } from '../providers/types.js';
import type { SkillTriggerEvaluatorConfig } from '../types.js';
import type { EvaluationContext, EvaluationScore, Evaluator } from './types.js';

/** Tool-name semantics for different provider kinds. */
interface ToolMatcher {
  /** Tool names that indicate skill invocation. */
  readonly skillTools: readonly string[];
  /** Input field that contains the skill name for skill tools. */
  readonly skillInputField: string;
  /** Tool names that indicate file read. */
  readonly readTools: readonly string[];
  /** Input field that contains the skill name for read tools. */
  readonly readInputField: string;
}

const CLAUDE_MATCHER: ToolMatcher = {
  skillTools: ['Skill'],
  skillInputField: 'skill',
  readTools: ['Read'],
  readInputField: 'file_path',
};

/** Copilot uses ACP protocol — tool names vary by version and context. */
const COPILOT_MATCHER: ToolMatcher = {
  skillTools: ['Skill', 'skill'],
  skillInputField: 'skill',
  readTools: ['Read File', 'readFile', 'Read', 'readTextFile'],
  readInputField: 'file_path',
};

/**
 * Static mapping of provider kinds to their tool-name semantics.
 * Providers not listed here fall back to CLAUDE_MATCHER.
 */
const PROVIDER_TOOL_SEMANTICS: Partial<Record<ProviderKind, ToolMatcher>> = {
  claude: CLAUDE_MATCHER,
  'claude-cli': CLAUDE_MATCHER,
  'claude-sdk': CLAUDE_MATCHER,
  'pi-coding-agent': CLAUDE_MATCHER,
  'pi-agent-sdk': CLAUDE_MATCHER,
  'copilot-cli': COPILOT_MATCHER,
  'copilot-sdk': COPILOT_MATCHER,
  vscode: COPILOT_MATCHER,
  'vscode-insiders': COPILOT_MATCHER,
};

export class SkillTriggerEvaluator implements Evaluator {
  readonly kind = 'skill-trigger';

  private readonly config: SkillTriggerEvaluatorConfig;

  constructor(config: SkillTriggerEvaluatorConfig) {
    this.config = config;
  }

  private resolveMatcher(providerKind: ProviderKind | undefined): ToolMatcher {
    if (providerKind) {
      const match = PROVIDER_TOOL_SEMANTICS[providerKind];
      if (match) return match;
    }
    return CLAUDE_MATCHER;
  }

  evaluate(context: EvaluationContext): EvaluationScore {
    const skillName = this.config.skill;
    const shouldTrigger = this.config.should_trigger !== false;
    const providerKind = context.provider?.kind as ProviderKind | undefined;
    const matcher = this.resolveMatcher(providerKind);

    const firstTool = (context.output ?? []).flatMap((msg) => msg.toolCalls ?? [])[0];

    let triggered = false;
    let evidence = '';

    if (firstTool) {
      const input = (firstTool.input ?? {}) as Record<string, unknown>;

      if (matcher.skillTools.includes(firstTool.tool)) {
        const skillArg = String(input[matcher.skillInputField] ?? '');
        if (skillArg.includes(skillName)) {
          triggered = true;
          evidence = `Skill tool invoked with ${matcher.skillInputField}="${skillArg}"`;
        }
      } else if (matcher.readTools.includes(firstTool.tool)) {
        const filePath = String(input[matcher.readInputField] ?? '');
        if (filePath.includes(skillName)) {
          triggered = true;
          evidence = `Read tool loaded skill file: ${filePath}`;
        }
      }
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
            ? `First tool was "${firstTool.tool}" — not a skill/read tool for "${skillName}"`
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
