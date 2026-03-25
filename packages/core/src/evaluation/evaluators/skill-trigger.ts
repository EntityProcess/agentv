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
  /** Tool-name prefixes that encode the skill directly in the tool name. */
  readonly skillToolPrefixes?: readonly string[];
  /** Tool-name prefixes that encode the file path directly in the tool name. */
  readonly readToolPrefixes?: readonly string[];
  /** Alternate input field names that may contain the file path. */
  readonly readInputFields?: readonly string[];
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
  skillToolPrefixes: ['Using skill: '],
  readToolPrefixes: ['Viewing '],
  readInputFields: ['file_path', 'path'],
};

/**
 * Pi CLI reads skill files using the lowercase `read` tool with a `path` argument.
 * Skills are auto-discovered from `.agents/skills/` relative to the working directory.
 *
 * Skill lookup order (workspace-scoped first):
 *   1. .agents/skills/<skill-name>/SKILL.md  (workspace-relative, auto-discovered)
 *   2. ~/.agents/skills/<skill-name>/SKILL.md (global fallback)
 */
const PI_CODING_AGENT_MATCHER: ToolMatcher = {
  skillTools: [],
  skillInputField: 'skill',
  readTools: ['read'],
  readInputField: 'path',
  readInputFields: ['path', 'file_path', 'filePath'],
};

/**
 * Codex reads skill files via command_execution using a bash sed command containing
 * the skill file path. The skill name appears in the command string, so we match
 * any command_execution whose command field includes the skill name.
 *
 * Skill lookup order (workspace-scoped first):
 *   1. .agents/skills/<skill-name>/SKILL.md  (workspace-relative)
 *   2. .codex/skills/<skill-name>/SKILL.md   (fallback)
 *   3. ~/.agents/skills/<skill-name>/SKILL.md (global fallback)
 *
 * MCP-based skill invocation (`mcp:<server>/<skill-name>`) is also supported for
 * Codex configurations that surface skills as MCP tools.
 */
const CODEX_MATCHER: ToolMatcher = {
  skillTools: [],
  skillInputField: 'skill',
  readTools: ['command_execution'],
  readInputField: 'command',
  skillToolPrefixes: ['mcp:'],
  readToolPrefixes: ['mcp:'],
  readInputFields: ['command', 'path', 'file_path', 'filePath'],
};

/**
 * Static mapping of provider kinds to their tool-name semantics.
 * Providers not listed here fall back to CLAUDE_MATCHER.
 */
const PROVIDER_TOOL_SEMANTICS: Partial<Record<ProviderKind, ToolMatcher>> = {
  claude: CLAUDE_MATCHER,
  'claude-cli': CLAUDE_MATCHER,
  'claude-sdk': CLAUDE_MATCHER,
  codex: CODEX_MATCHER,
  'pi-coding-agent': PI_CODING_AGENT_MATCHER,
  'pi-cli': PI_CODING_AGENT_MATCHER,
  'copilot-cli': COPILOT_MATCHER,
  'copilot-log': COPILOT_MATCHER,
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

    const allToolCalls = (context.output ?? []).flatMap((msg) => msg.toolCalls ?? []);

    let triggered = false;
    let evidence = '';

    for (const toolCall of allToolCalls) {
      const toolName = toolCall.tool ?? '';
      const input = (toolCall.input ?? {}) as Record<string, unknown>;

      if (matcher.skillTools.includes(toolName)) {
        const skillArg = String(input[matcher.skillInputField] ?? '');
        if (skillArg.includes(skillName)) {
          triggered = true;
          evidence = `Skill tool invoked with ${matcher.skillInputField}="${skillArg}"`;
          break;
        }
      } else if (
        matcher.skillToolPrefixes?.some(
          (prefix) => toolName.startsWith(prefix) && toolName.includes(skillName),
        )
      ) {
        triggered = true;
        evidence = `Skill tool invoked via tool name "${toolName}"`;
        break;
      } else if (matcher.readTools.includes(toolName)) {
        const filePath = this.readPathFromInput(input, matcher);
        if (filePath.includes(skillName)) {
          triggered = true;
          evidence = `Read tool loaded skill file: ${filePath}`;
          break;
        }
      } else if (
        matcher.readToolPrefixes?.some(
          (prefix) => toolName.startsWith(prefix) && toolName.includes(skillName),
        )
      ) {
        triggered = true;
        evidence = `Read tool loaded skill file via tool name "${toolName}"`;
        break;
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

  private readPathFromInput(input: Record<string, unknown>, matcher: ToolMatcher): string {
    const fields = matcher.readInputFields ?? [matcher.readInputField];
    for (const field of fields) {
      const value = input[field];
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
    return '';
  }
}
