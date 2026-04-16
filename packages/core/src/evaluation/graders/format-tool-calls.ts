/**
 * Formats tool calls from agent output messages into a human-readable summary.
 *
 * Used by `{{ tool_calls }}` template variable in LLM grader prompts.
 * Extracts key input fields per tool to keep the summary compact:
 *   - Skill: `skill` arg
 *   - Read/Write/Edit: `file_path`
 *   - Bash: `command`
 *   - Grep/Glob: `pattern`
 *   - Other tools: first string-valued input field (if any)
 *
 * Returns empty string when there are no tool calls (template variable resolves to '').
 */

import type { Message } from '../providers/types.js';

/**
 * Key input fields to extract per tool name.
 * Order matters — first matching field wins.
 */
const KEY_INPUT_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['Skill', ['skill']],
  ['Read', ['file_path']],
  ['Write', ['file_path']],
  ['Edit', ['file_path']],
  ['Bash', ['command']],
  ['Grep', ['pattern']],
  ['Glob', ['pattern']],
]);

/** Fallback: pick the first short string-valued field from input. */
const MAX_FALLBACK_LENGTH = 120;

export function formatToolCalls(output: readonly Message[] | undefined): string {
  if (!output) return '';

  const lines: string[] = [];

  for (const message of output) {
    if (!message.toolCalls) continue;
    for (const call of message.toolCalls) {
      const toolName = call.tool ?? 'unknown';
      const detail = extractKeyDetail(toolName, call.input);
      lines.push(detail ? `- ${toolName}: ${detail}` : `- ${toolName}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '';
}

function extractKeyDetail(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;

  // Try known key fields for this tool
  const knownFields = KEY_INPUT_FIELDS.get(toolName);
  if (knownFields) {
    for (const field of knownFields) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) {
        return truncate(value);
      }
    }
  }

  // Fallback: first short string-valued field
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.length > 0 && value.length <= MAX_FALLBACK_LENGTH) {
      return truncate(value);
    }
  }

  return '';
}

function truncate(value: string, maxLen = 120): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…`;
}
