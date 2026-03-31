/**
 * Claude Code session JSONL parser.
 *
 * Reads a Claude Code session transcript (~/.claude/projects/<encoded-path>/<uuid>.jsonl)
 * and converts it to AgentV's Message[] format.
 *
 * Each line is a JSON object with:
 *   { type, message: { role, content }, sessionId, timestamp, uuid, requestId, ... }
 *
 * Supported event types:
 *   user      → Message { role: 'user' } (also contains tool_result blocks)
 *   assistant → Message { role: 'assistant', toolCalls from tool_use content blocks }
 *
 * Skipped event types: progress, system, file-history-snapshot
 *
 * Key behaviors:
 *   - tool_use blocks in assistant events → ToolCall (pending output)
 *   - tool_result blocks in user events → matched to pending tool_use by tool_use_id
 *   - Usage is cumulative per requestId; only the last value per requestId is used
 *   - Streaming assistant events with the same requestId are deduplicated (keep latest)
 *   - Subagent events (isSidechain: true) are filtered out in v1
 *   - Duration is from first↔last event timestamp (including skipped types)
 *   - cost_usd is null (Claude Code does not report per-session cost)
 */

import type { Message, ToolCall } from '../evaluation/providers/types.js';
import type { TranscriptEntry, TranscriptSource } from './types.js';

interface ClaudeEvent {
  readonly type: string;
  readonly requestId?: string;
  readonly isSidechain?: boolean;
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

  // Track usage per requestId — values are cumulative, so we only keep the last
  const usageByRequestId = new Map<string, ClaudeUsage>();

  // Track the last assistant message per requestId to deduplicate streaming updates
  let lastAssistantRequestId: string | undefined;
  let lastAssistantIdx = -1;

  // Track pending tool_use IDs for pairing with tool_result in user events
  const pendingToolCalls = new Map<string, { msgIdx: number; toolIdx: number }>();

  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let event: ClaudeEvent;
    try {
      event = JSON.parse(line) as ClaudeEvent;
    } catch {
      continue;
    }

    if (!event.type) continue;

    // Track timestamps from ALL events (including skipped types) for accurate duration
    if (event.timestamp) {
      if (!startTimestamp) startTimestamp = event.timestamp;
      endTimestamp = event.timestamp;
    }

    // Skip non-message event types
    if (SKIPPED_TYPES.has(event.type)) continue;

    // Skip subagent events (v1: only process main conversation)
    if (event.isSidechain) continue;

    // Capture session metadata from first event
    if (!sessionId && event.sessionId) {
      sessionId = event.sessionId;
    }
    if (!projectPath && event.cwd) {
      projectPath = event.cwd;
    }

    switch (event.type) {
      case 'user': {
        const msg = event.message;
        if (!msg) break;

        const contentArr = msg.content;

        // User events can contain both tool_result blocks (responses to tool_use)
        // and text blocks. Process tool_results first, then extract text.
        if (Array.isArray(contentArr)) {
          for (const block of contentArr as readonly ClaudeContentBlock[]) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const pending = pendingToolCalls.get(block.tool_use_id);
              if (pending) {
                const existingMsg = messages[pending.msgIdx];
                const existingCalls = [...(existingMsg.toolCalls ?? [])];
                existingCalls[pending.toolIdx] = {
                  ...existingCalls[pending.toolIdx],
                  output: extractToolResultContent(block.content),
                };
                messages[pending.msgIdx] = { ...existingMsg, toolCalls: existingCalls };
                pendingToolCalls.delete(block.tool_use_id);
              }
            }
          }
        }

        // Extract text content for the user message
        const text = extractTextContent(contentArr);
        if (text !== undefined) {
          messages.push({ role: 'user', content: text });
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

        // Track usage (cumulative per requestId — last value wins)
        if (msg.usage && event.requestId) {
          usageByRequestId.set(event.requestId, msg.usage);
        }

        // Parse content array for text and tool_use blocks
        const { text, toolCalls } = extractAssistantContent(msg.content);

        // Deduplicate streaming assistant events with the same requestId
        if (
          event.requestId &&
          event.requestId === lastAssistantRequestId &&
          lastAssistantIdx >= 0
        ) {
          // Replace the previous partial message
          messages[lastAssistantIdx] = {
            role: 'assistant',
            content: text || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          };
          // Re-register tool calls for pairing
          registerPendingToolCalls(toolCalls, lastAssistantIdx, pendingToolCalls);
        } else {
          // Only push if there's actual content or tool calls
          if (text || toolCalls.length > 0) {
            lastAssistantIdx = messages.length;
            messages.push({
              role: 'assistant',
              content: text || undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
            registerPendingToolCalls(toolCalls, lastAssistantIdx, pendingToolCalls);
          }
        }
        lastAssistantRequestId = event.requestId;
        break;
      }
    }
  }

  // Compute final usage from last-seen value per requestId
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const usage of usageByRequestId.values()) {
    totalInputTokens += Number(usage.input_tokens ?? 0);
    totalOutputTokens += Number(usage.output_tokens ?? 0);
  }
  const hasUsage = usageByRequestId.size > 0;

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
 * Register tool_use IDs from an assistant message for later pairing with tool_result.
 */
function registerPendingToolCalls(
  toolCalls: ToolCall[],
  msgIdx: number,
  pending: Map<string, { msgIdx: number; toolIdx: number }>,
): void {
  for (let i = 0; i < toolCalls.length; i++) {
    const id = toolCalls[i].id;
    if (id) {
      pending.set(id, { msgIdx, toolIdx: i });
    }
  }
}

/**
 * Extract text content from a message's content field.
 */
function extractTextContent(
  content: string | readonly ClaudeContentBlock[] | undefined,
): string | undefined {
  if (content === undefined || content === null) return undefined;
  if (typeof content === 'string') return content;

  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    }
  }
  return textParts.length > 0 ? textParts.join('') : undefined;
}

/**
 * Extract text and tool_use calls from an assistant message's content array.
 * Note: tool_result blocks appear in user events, not here.
 */
function extractAssistantContent(content: string | readonly ClaudeContentBlock[] | undefined): {
  text: string | undefined;
  toolCalls: ToolCall[];
} {
  if (content === undefined || content === null) {
    return { text: undefined, toolCalls: [] };
  }
  if (typeof content === 'string') {
    return { text: content, toolCalls: [] };
  }

  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) textParts.push(block.text);
        break;

      case 'tool_use':
        if (block.name) {
          toolCalls.push({
            tool: block.name,
            input: block.input,
            id: block.id,
          });
        }
        break;

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
