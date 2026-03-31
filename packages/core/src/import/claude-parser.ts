/**
 * Claude Code session JSONL parser.
 *
 * Reads a Claude Code session transcript (~/.claude/projects/<encoded-path>/<uuid>.jsonl)
 * and converts it to AgentV's Message[] format.
 *
 * Each line is a JSON object with:
 *   { type, message: { role, content }, sessionId, timestamp, uuid, ... }
 *
 * Supported event types:
 *   user      → Message { role: 'user' }
 *   assistant → Message { role: 'assistant', toolCalls extracted from content array }
 *   progress  → skipped
 *   system    → skipped
 *   file-history-snapshot → skipped
 *
 * Tool calls are extracted from assistant message content arrays:
 *   - content blocks with type: 'tool_use' → ToolCall
 *   - content blocks with type: 'tool_result' → attached as output to matching ToolCall
 *
 * Usage is aggregated from assistant event message.usage blocks.
 * Duration is computed from first↔last event timestamp delta.
 * cost_usd is null (Claude Code does not report per-session cost).
 *
 * Subagent sessions (identified by parentUuid chains) are skipped for v1.
 */

import type { Message, ToolCall } from '../evaluation/providers/types.js';
import type { TranscriptEntry, TranscriptSource } from './types.js';

interface ClaudeEvent {
  readonly type: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: string | readonly ClaudeContentBlock[];
    readonly usage?: ClaudeUsage;
    readonly model?: string;
  };
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly uuid?: string;
  readonly cwd?: string;
}

interface ClaudeContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly id?: string;
  readonly tool_use_id?: string;
  readonly content?: string | readonly { readonly type: string; readonly text?: string }[];
}

interface ClaudeUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

const SKIPPED_TYPES = new Set(['progress', 'system', 'file-history-snapshot']);

export function parseClaudeSession(jsonl: string): TranscriptEntry {
  const messages: Message[] = [];
  let sessionId = '';
  let projectPath: string | undefined;
  let model: string | undefined;
  let startTimestamp: string | undefined;
  let endTimestamp: string | undefined;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hasUsage = false;

  // Track the last assistant message UUID to deduplicate streaming updates.
  // Claude Code emits multiple `assistant` events with the same requestId
  // as content streams in; we only keep the latest one per requestId.
  let lastAssistantRequestId: string | undefined;
  let lastAssistantIdx = -1;

  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let event: ClaudeEvent;
    try {
      event = JSON.parse(line) as ClaudeEvent;
    } catch {
      continue;
    }

    if (!event.type || SKIPPED_TYPES.has(event.type)) continue;

    // Capture session metadata from first event
    if (!sessionId && event.sessionId) {
      sessionId = event.sessionId;
    }
    if (!projectPath && event.cwd) {
      projectPath = event.cwd;
    }

    // Track timestamps for duration calculation
    if (event.timestamp) {
      if (!startTimestamp) startTimestamp = event.timestamp;
      endTimestamp = event.timestamp;
    }

    switch (event.type) {
      case 'user': {
        const msg = event.message;
        if (!msg) break;

        const content = extractTextContent(msg.content);
        if (content !== undefined) {
          messages.push({ role: 'user', content });
        }
        break;
      }

      case 'assistant': {
        const msg = event.message;
        if (!msg) break;

        // Capture model from first assistant message
        if (!model && msg.model) {
          model = msg.model;
        }

        // Aggregate usage
        if (msg.usage) {
          hasUsage = true;
          totalInputTokens += Number(msg.usage.input_tokens ?? 0);
          totalOutputTokens += Number(msg.usage.output_tokens ?? 0);
        }

        // Extract requestId for deduplication (stored on raw event)
        const requestId = (event as unknown as Record<string, unknown>).requestId as
          | string
          | undefined;

        // Parse content array for text, tool_use, and tool_result blocks
        const { text, toolCalls } = extractAssistantContent(msg.content);

        // Deduplicate streaming assistant events with the same requestId
        if (requestId && requestId === lastAssistantRequestId && lastAssistantIdx >= 0) {
          // Replace the previous partial message
          messages[lastAssistantIdx] = {
            role: 'assistant',
            content: text || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          };
        } else {
          // Only push if there's actual content or tool calls
          if (text || toolCalls.length > 0) {
            lastAssistantIdx = messages.length;
            messages.push({
              role: 'assistant',
              content: text || undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
        lastAssistantRequestId = requestId;
        break;
      }
    }
  }

  let durationMs: number | undefined;
  if (startTimestamp && endTimestamp) {
    durationMs = new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  }

  const source: TranscriptSource = {
    provider: 'claude',
    sessionId,
    projectPath,
    startedAt: startTimestamp,
    model,
  };

  return {
    messages,
    source,
    tokenUsage: hasUsage ? { input: totalInputTokens, output: totalOutputTokens } : undefined,
    durationMs,
    costUsd: null,
  };
}

/**
 * Extract text content from a message's content field.
 */
function extractTextContent(
  content: string | readonly ClaudeContentBlock[] | undefined,
): string | undefined {
  if (content === undefined || content === null) return undefined;
  if (typeof content === 'string') return content;

  // Content array — concatenate text blocks
  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    }
  }
  return textParts.length > 0 ? textParts.join('') : undefined;
}

/**
 * Extract text and tool calls from an assistant message's content array.
 */
function extractAssistantContent(
  content: string | readonly ClaudeContentBlock[] | undefined,
): { text: string | undefined; toolCalls: ToolCall[] } {
  if (content === undefined || content === null) {
    return { text: undefined, toolCalls: [] };
  }
  if (typeof content === 'string') {
    return { text: content, toolCalls: [] };
  }

  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  // Map tool_use id → index in toolCalls for pairing with tool_result
  const toolUseIndex = new Map<string, number>();

  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) textParts.push(block.text);
        break;

      case 'tool_use':
        if (block.name) {
          const idx = toolCalls.length;
          toolCalls.push({
            tool: block.name,
            input: block.input,
            id: block.id,
          });
          if (block.id) {
            toolUseIndex.set(block.id, idx);
          }
        }
        break;

      case 'tool_result': {
        const toolUseId = block.tool_use_id;
        if (toolUseId && toolUseIndex.has(toolUseId)) {
          const idx = toolUseIndex.get(toolUseId)!;
          const existing = toolCalls[idx];
          const output = extractToolResultContent(block.content);
          toolCalls[idx] = { ...existing, output };
        }
        break;
      }

      // Skip thinking blocks and other types
    }
  }

  return {
    text: textParts.length > 0 ? textParts.join('') : undefined,
    toolCalls,
  };
}

/**
 * Extract text from a tool_result content field.
 */
function extractToolResultContent(
  content: string | readonly { readonly type: string; readonly text?: string }[] | undefined,
): string | undefined {
  if (content === undefined || content === null) return undefined;
  if (typeof content === 'string') return content;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}
