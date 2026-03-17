/**
 * Built-in skill-trigger evaluator.
 *
 * Detects whether the agent invoked a named skill as its first tool call.
 * Supports multiple provider kinds via static tool-name mappings and
 * per-evaluator config overrides.
 *
 * Mirrors the post-hoc fallback detection in skill-creator's run_eval.py:
 *   - Only the FIRST tool call matters.
 *   - Skill tool: checks input.[skillInputField] contains the skill name (case-sensitive substring).
 *   - Read tool: checks input.[readInputField] contains the skill name (case-sensitive substring).
 *   - Any other tool as first call means the skill was not triggered.
 *   - Supports negative cases via should_trigger: false.
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

/**
 * Static mapping of provider kinds to their tool-name semantics.
 * Providers not listed here fall back to CLAUDE_MATCHER.
 */
const PROVIDER_TOOL_SEMANTICS: Partial<Record<ProviderKind, ToolMatcher>> = {
  claude: CLAUDE_MATCHER,
  'claude-cli': CLAUDE_MATCHER,
  'claude-sdk': CLAUDE_MATCHER,
  'pi-coding-agent': CLAUDE_MATCHER,
  'copilot-cli': {
    skillTools: ['Skill', 'skill'],
    skillInputField: 'skill',
    readTools: ['Read File', 'readFile', 'Read', 'readTextFile'],
    readInputField: 'file_path',
  },
  'copilot-sdk': {
    skillTools: ['Skill', 'skill'],
    skillInputField: 'skill',
    readTools: ['Read File', 'readFile', 'Read', 'readTextFile'],
    readInputField: 'file_path',
  },
  vscode: {
    skillTools: ['Skill', 'skill'],
    skillInputField: 'skill',
    readTools: ['Read File', 'readFile', 'Read', 'readTextFile'],
    readInputField: 'file_path',
  },
  'vscode-insiders': {
    skillTools: ['Skill', 'skill'],
    skillInputField: 'skill',
    readTools: ['Read File', 'readFile', 'Read', 'readTextFile'],
    readInputField: 'file_path',
  },
};

/** Providers known to never emit tool calls. */
const NO_TOOL_CALL_PROVIDERS: ReadonlySet<ProviderKind> = new Set(['codex']);

export class SkillTriggerEvaluator implements Evaluator {
  readonly kind = 'skill-trigger';

  private readonly config: SkillTriggerEvaluatorConfig;

  constructor(config: SkillTriggerEvaluatorConfig) {
    this.config = config;
  }

  private resolveMatcher(providerKind: ProviderKind | undefined): ToolMatcher {
    // Config-level overrides take highest precedence
    if (this.config.skill_tools || this.config.read_tools) {
      return {
        skillTools: this.config.skill_tools ?? CLAUDE_MATCHER.skillTools,
        skillInputField: this.config.skill_input_field ?? CLAUDE_MATCHER.skillInputField,
        readTools: this.config.read_tools ?? CLAUDE_MATCHER.readTools,
        readInputField: this.config.read_input_field ?? CLAUDE_MATCHER.readInputField,
      };
    }
    // Provider-based lookup
    if (providerKind) {
      const match = PROVIDER_TOOL_SEMANTICS[providerKind];
      if (match) return match;
    }
    // Default to Claude semantics
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

    // Check for providers known to not emit tool calls
    if (!firstTool && providerKind && NO_TOOL_CALL_PROVIDERS.has(providerKind)) {
      return {
        score: shouldTrigger ? 0 : 1,
        verdict: shouldTrigger ? 'fail' : 'pass',
        hits: shouldTrigger
          ? []
          : [`Provider "${providerKind}" does not emit tool calls — no false trigger possible`],
        misses: shouldTrigger
          ? [
              `Provider "${providerKind}" does not emit tool calls — skill-trigger evaluation is not supported. Consider using a different evaluator type (e.g., contains, llm-judge) for this provider.`,
            ]
          : [],
        expectedAspectCount: 1,
        reasoning: `Provider "${providerKind}" does not support tool call detection`,
      };
    }

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
