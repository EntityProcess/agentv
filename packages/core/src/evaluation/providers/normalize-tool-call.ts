/**
 * Canonical ToolCall name normalization.
 *
 * Maps provider-native tool names and input fields to canonical values so that
 * downstream consumers (evaluators, analytics, transcript writers) never need
 * provider-specific matching logic.
 *
 * Canonical tool names (Claude's naming is the canonical set):
 *   - "Skill"  — skill invocation
 *   - "Read"   — file read
 *   - "Write"  — file write
 *   - "Edit"   — file edit
 *   - "Bash"   — shell command execution
 *
 * Tools not in the mapping table pass through unchanged.
 *
 * To add a new provider:
 *   1. Add entries to TOOL_NAME_MAP for that provider's native tool names.
 *   2. If the provider encodes info in tool-name prefixes (e.g. "Using skill: X"),
 *      add entries to TOOL_PREFIX_MAP.
 *   3. Add input-field normalizations to INPUT_FIELD_NORMALIZERS if the provider
 *      uses non-canonical field names (e.g. `path` instead of `file_path`).
 */

import type { ProviderKind } from './types.js';
import type { ToolCall } from './types.js';

// ---------------------------------------------------------------------------
// Canonical tool names
// ---------------------------------------------------------------------------

type CanonicalTool = 'Skill' | 'Read' | 'Write' | 'Edit' | 'Bash';

// ---------------------------------------------------------------------------
// Static mapping: provider × native-name → canonical name
// ---------------------------------------------------------------------------

/**
 * Exact tool-name mapping per provider kind.
 * Key = `${providerKind}::${nativeToolName}`, value = canonical name.
 *
 * Providers whose names already match canonical (Claude variants) still have
 * entries for explicitness and forward safety.
 */
const TOOL_NAME_MAP = new Map<string, CanonicalTool>([
  // --- Claude (already canonical) ---
  ['claude::Skill', 'Skill'],
  ['claude::Read', 'Read'],
  ['claude::Write', 'Write'],
  ['claude::Edit', 'Edit'],
  ['claude::Bash', 'Bash'],
  ['claude-cli::Skill', 'Skill'],
  ['claude-cli::Read', 'Read'],
  ['claude-cli::Write', 'Write'],
  ['claude-cli::Edit', 'Edit'],
  ['claude-cli::Bash', 'Bash'],
  ['claude-sdk::Skill', 'Skill'],
  ['claude-sdk::Read', 'Read'],
  ['claude-sdk::Write', 'Write'],
  ['claude-sdk::Edit', 'Edit'],
  ['claude-sdk::Bash', 'Bash'],

  // --- Copilot ---
  ['copilot-cli::Skill', 'Skill'],
  ['copilot-cli::skill', 'Skill'],
  ['copilot-cli::Read File', 'Read'],
  ['copilot-cli::readFile', 'Read'],
  ['copilot-cli::Read', 'Read'],
  ['copilot-cli::readTextFile', 'Read'],
  ['copilot-cli::writeTextFile', 'Write'],
  ['copilot-cli::Write File', 'Write'],
  ['copilot-cli::editFile', 'Edit'],
  ['copilot-cli::Edit File', 'Edit'],
  ['copilot-cli::runTerminalCommand', 'Bash'],

  ['copilot-sdk::Skill', 'Skill'],
  ['copilot-sdk::skill', 'Skill'],
  ['copilot-sdk::Read File', 'Read'],
  ['copilot-sdk::readFile', 'Read'],
  ['copilot-sdk::Read', 'Read'],
  ['copilot-sdk::readTextFile', 'Read'],
  ['copilot-sdk::writeTextFile', 'Write'],
  ['copilot-sdk::Write File', 'Write'],
  ['copilot-sdk::editFile', 'Edit'],
  ['copilot-sdk::Edit File', 'Edit'],
  ['copilot-sdk::runTerminalCommand', 'Bash'],

  ['copilot-log::Skill', 'Skill'],
  ['copilot-log::skill', 'Skill'],
  ['copilot-log::Read File', 'Read'],
  ['copilot-log::readFile', 'Read'],
  ['copilot-log::Read', 'Read'],
  ['copilot-log::readTextFile', 'Read'],
  ['copilot-log::writeTextFile', 'Write'],
  ['copilot-log::Write File', 'Write'],
  ['copilot-log::editFile', 'Edit'],
  ['copilot-log::Edit File', 'Edit'],
  ['copilot-log::runTerminalCommand', 'Bash'],

  ['vscode::Skill', 'Skill'],
  ['vscode::skill', 'Skill'],
  ['vscode::Read File', 'Read'],
  ['vscode::readFile', 'Read'],
  ['vscode::Read', 'Read'],
  ['vscode::readTextFile', 'Read'],
  ['vscode::writeTextFile', 'Write'],
  ['vscode::Write File', 'Write'],
  ['vscode::editFile', 'Edit'],
  ['vscode::Edit File', 'Edit'],
  ['vscode::runTerminalCommand', 'Bash'],

  ['vscode-insiders::Skill', 'Skill'],
  ['vscode-insiders::skill', 'Skill'],
  ['vscode-insiders::Read File', 'Read'],
  ['vscode-insiders::readFile', 'Read'],
  ['vscode-insiders::Read', 'Read'],
  ['vscode-insiders::readTextFile', 'Read'],
  ['vscode-insiders::writeTextFile', 'Write'],
  ['vscode-insiders::Write File', 'Write'],
  ['vscode-insiders::editFile', 'Edit'],
  ['vscode-insiders::Edit File', 'Edit'],
  ['vscode-insiders::runTerminalCommand', 'Bash'],

  // --- Codex ---
  ['codex::command_execution', 'Bash'],
  ['codex::file_change', 'Edit'],

  // --- Pi ---
  ['pi-coding-agent::read', 'Read'],
  ['pi-coding-agent::bash', 'Bash'],
  ['pi-cli::read', 'Read'],
  ['pi-cli::bash', 'Bash'],
]);

// ---------------------------------------------------------------------------
// Prefix-based mapping: provider × prefix → canonical name
// ---------------------------------------------------------------------------

/**
 * Prefix-based tool-name mappings for providers that encode information in the
 * tool name itself (e.g. Copilot's "Using skill: X" or Codex's "mcp:/...").
 *
 * Checked when no exact match is found in TOOL_NAME_MAP.
 */
interface PrefixRule {
  readonly prefix: string;
  readonly canonical: CanonicalTool;
  /** If true, extract the suffix after the prefix as input.skill */
  readonly extractSkillFromName?: boolean;
}

const COPILOT_PREFIXES: readonly PrefixRule[] = [
  { prefix: 'Using skill: ', canonical: 'Skill', extractSkillFromName: true },
  { prefix: 'Viewing ', canonical: 'Read' },
];

const CODEX_PREFIXES: readonly PrefixRule[] = [
  { prefix: 'mcp:', canonical: 'Skill', extractSkillFromName: true },
];

const TOOL_PREFIX_MAP = new Map<string, readonly PrefixRule[]>([
  ['copilot-cli', COPILOT_PREFIXES],
  ['copilot-sdk', COPILOT_PREFIXES],
  ['copilot-log', COPILOT_PREFIXES],
  ['vscode', COPILOT_PREFIXES],
  ['vscode-insiders', COPILOT_PREFIXES],
  ['codex', CODEX_PREFIXES],
]);

// ---------------------------------------------------------------------------
// Input field normalization
// ---------------------------------------------------------------------------

/**
 * After tool-name normalization, ensure canonical input field names exist.
 * E.g. if a provider uses `input.path` for reads, copy it to `input.file_path`.
 */
type InputNormalizer = (input: Record<string, unknown>) => Record<string, unknown>;

const normalizeSkillInput: InputNormalizer = (input) => {
  if (input.skill !== undefined) return input;
  return input;
};

const normalizeReadInput: InputNormalizer = (input) => {
  if (input.file_path !== undefined) return input;
  if (input.path !== undefined) return { ...input, file_path: input.path };
  if (input.filePath !== undefined) return { ...input, file_path: input.filePath };
  return input;
};

const INPUT_NORMALIZERS = new Map<CanonicalTool, InputNormalizer>([
  ['Skill', normalizeSkillInput],
  ['Read', normalizeReadInput],
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize a ToolCall's tool name and input fields to canonical values.
 *
 * This is a pure function — provider kind in, canonical ToolCall out.
 * Unknown tool names pass through unchanged.
 */
export function normalizeToolCall(providerKind: ProviderKind, tc: ToolCall): ToolCall {
  const nativeName = tc.tool;

  // 1. Try exact match
  const exactKey = `${providerKind}::${nativeName}`;
  const canonical = TOOL_NAME_MAP.get(exactKey);
  if (canonical) {
    return applyInputNormalization(canonical, { ...tc, tool: canonical });
  }

  // 2. Try prefix match
  const prefixRules = TOOL_PREFIX_MAP.get(providerKind);
  if (prefixRules) {
    for (const rule of prefixRules) {
      if (nativeName.startsWith(rule.prefix)) {
        const suffix = nativeName.slice(rule.prefix.length);
        let normalizedInput = tc.input;

        if (rule.extractSkillFromName && suffix) {
          const existingInput = (tc.input as Record<string, unknown> | undefined) ?? {};
          normalizedInput = { ...existingInput, skill: suffix };
        }

        const normalized: ToolCall = {
          ...tc,
          tool: rule.canonical,
          input: normalizedInput,
        };
        return applyInputNormalization(rule.canonical, normalized);
      }
    }
  }

  // 3. No match — pass through unchanged
  return tc;
}

function applyInputNormalization(canonical: CanonicalTool, tc: ToolCall): ToolCall {
  const normalizer = INPUT_NORMALIZERS.get(canonical);
  if (!normalizer || tc.input === undefined || tc.input === null) return tc;

  const input = tc.input as Record<string, unknown>;
  const normalized = normalizer(input);
  return normalized === input ? tc : { ...tc, input: normalized };
}
