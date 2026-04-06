/**
 * Codex CLI session JSONL parser.
 *
 * Reads a Codex CLI rollout transcript
 * (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) and converts it to AgentV's
 * Message[] format.
 *
 * Each line is a JSON object with one of these top-level types:
 *   session_meta   → session metadata (id, cwd, cli_version, model)
 *   turn_context   → per-turn context (model, cwd, turn_id)
 *   event_msg      → events: task_started, task_complete, user_message,
 *                     agent_message, token_count
 *   response_item  → conversation items: message, function_call,
 *                     function_call_output, reasoning, custom_tool_call,
 *                     custom_tool_call_output
 *
 * Key behaviors:
 *   - response_item with type=message and role=user → user Message
 *   - response_item with type=message and role=assistant → assistant Message
 *   - response_item with type=function_call → ToolCall (pending output)
 *   - response_item with type=function_call_output → matched to pending call by call_id
 *   - response_item with type=reasoning → skipped (thinking tokens)
 *   - response_item with role=developer → skipped (system prompt)
 *   - session_meta → source metadata (session_id, cwd, version, model)
 *   - turn_context → model name extraction
 *   - Duration is from first↔last event timestamp
 *   - cost_usd is null (Codex CLI does not report per-session cost)
 *   - Token usage not available from rollout format (rate limit info only)
 *
 * To add a new response_item type: add a case to the switch in parseCodexSession().
 */

import type { Message, ToolCall } from '../evaluation/providers/types.js';
import type { TranscriptEntry, TranscriptSource } from './types.js';

interface CodexLine {
  readonly timestamp?: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export function parseCodexSession(jsonl: string): TranscriptEntry {
  const messages: Message[] = [];
  let sessionId = '';
  let cwd: string | undefined;
  let model: string | undefined;
  let version: string | undefined;
  let startTimestamp: string | undefined;
  let endTimestamp: string | undefined;

  // Track pending function calls by call_id
  const pendingCalls = new Map<string, { msgIdx: number; toolIdx: number }>();

  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let entry: CodexLine;
    try {
      entry = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }

    if (!entry.type) continue;

    // Track timestamps for duration
    if (entry.timestamp) {
      if (!startTimestamp) startTimestamp = entry.timestamp;
      endTimestamp = entry.timestamp;
    }

    const payload = entry.payload ?? {};

    switch (entry.type) {
      case 'session_meta': {
        sessionId = String(payload.id ?? '');
        cwd = payload.cwd ? String(payload.cwd) : undefined;
        version = payload.cli_version ? String(payload.cli_version) : undefined;
        if (payload.model && !model) {
          model = String(payload.model);
        }
        break;
      }

      case 'turn_context': {
        if (payload.model && !model) {
          model = String(payload.model);
        }
        if (payload.cwd && !cwd) {
          cwd = String(payload.cwd);
        }
        break;
      }

      case 'response_item': {
        const itemType = String(payload.type ?? '');
        const role = String(payload.role ?? '');

        switch (itemType) {
          case 'message': {
            // Skip developer (system prompt) messages
            if (role === 'developer') break;

            const content = extractResponseItemContent(payload.content);
            if (role === 'user' && content) {
              messages.push({ role: 'user', content });
            } else if (role === 'assistant' && content) {
              messages.push({ role: 'assistant', content });
            }
            break;
          }

          case 'function_call': {
            const toolName = String(payload.name ?? '');
            const callId = String(payload.call_id ?? '');
            let input: unknown;
            if (typeof payload.arguments === 'string') {
              try {
                input = JSON.parse(payload.arguments);
              } catch {
                input = payload.arguments;
              }
            } else {
              input = payload.arguments;
            }

            const toolCall: ToolCall = { tool: toolName, input, id: callId };
            const msgIdx = messages.length;
            messages.push({
              role: 'assistant',
              toolCalls: [toolCall],
            });

            if (callId) {
              pendingCalls.set(callId, { msgIdx, toolIdx: 0 });
            }
            break;
          }

          case 'custom_tool_call': {
            const toolName = String(payload.name ?? '');
            const callId = String(payload.call_id ?? '');
            let input: unknown;
            if (typeof payload.arguments === 'string') {
              try {
                input = JSON.parse(payload.arguments);
              } catch {
                input = payload.arguments;
              }
            } else {
              input = payload.arguments;
            }

            const toolCall: ToolCall = { tool: toolName, input, id: callId };
            const msgIdx = messages.length;
            messages.push({
              role: 'assistant',
              toolCalls: [toolCall],
            });

            if (callId) {
              pendingCalls.set(callId, { msgIdx, toolIdx: 0 });
            }
            break;
          }

          case 'function_call_output':
          case 'custom_tool_call_output': {
            const callId = String(payload.call_id ?? '');
            const pending = pendingCalls.get(callId);
            if (pending) {
              const existingMsg = messages[pending.msgIdx];
              const existingCalls = [...(existingMsg.toolCalls ?? [])];
              existingCalls[pending.toolIdx] = {
                ...existingCalls[pending.toolIdx],
                output: payload.output,
              };
              messages[pending.msgIdx] = { ...existingMsg, toolCalls: existingCalls };
              pendingCalls.delete(callId);
            }
            break;
          }

          // Skip reasoning blocks (thinking tokens)
          case 'reasoning':
            break;
        }
        break;
      }

      // Skip event_msg types (task_started, task_complete, token_count, etc.)
      // They don't contain conversation content
    }
  }

  let durationMs: number | undefined;
  if (startTimestamp && endTimestamp) {
    durationMs = new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  }

  const source: TranscriptSource = {
    provider: 'codex',
    sessionId,
    cwd,
    startedAt: startTimestamp,
    model,
    version,
  };

  return {
    messages,
    source,
    // Codex rollout files don't include token counts (only rate limit info)
    tokenUsage: undefined,
    durationMs,
    costUsd: null,
  };
}

/**
 * Extract text content from a Codex response_item content array.
 * Content is typically: [{ type: "input_text"|"output_text", text: "..." }]
 */
function extractResponseItemContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      if (typeof b.text === 'string') {
        parts.push(b.text);
      }
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}
