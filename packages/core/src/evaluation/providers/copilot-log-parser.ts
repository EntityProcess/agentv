/**
 * Copilot CLI events.jsonl parser.
 *
 * Reads a Copilot CLI session transcript (events.jsonl) and converts it to
 * AgentV's Message[] format. Each line is a JSON object with:
 *   { type, data: { ...payload }, id, timestamp, parentId }
 *
 * All event-specific fields live under event.data.*, while type, id, timestamp,
 * and parentId are at the top level.
 *
 * Supported event types:
 *   session.start    → session metadata (data.sessionId, data.context.cwd)
 *   user.message     → Message { role: 'user' }
 *   assistant.message → Message { role: 'assistant', toolCalls from data.toolRequests }
 *   skill.invoked    → ToolCall { tool: 'Skill', input: { skill: data.name } }
 *   tool.execution_start + tool.execution_complete → ToolCall with output
 *   session.shutdown → token usage from data.modelMetrics, end timestamp
 *
 * To add a new event type:
 *   1. Add a case to the switch in parseCopilotEvents()
 *   2. Map it to a Message or ToolCall
 *   3. Add a test in copilot-log-parser.test.ts
 */

import type { Message, ProviderTokenUsage, ToolCall } from './types.js';

export interface CopilotSessionMeta {
  readonly sessionId: string;
  readonly model: string;
  readonly cwd: string;
  readonly repository?: string;
  readonly branch?: string;
  readonly startedAt?: string;
}

export interface ParsedCopilotSession {
  readonly messages: Message[];
  readonly meta: CopilotSessionMeta;
  readonly tokenUsage?: ProviderTokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
}

interface ToolCallInProgress {
  readonly toolName: string;
  readonly input?: unknown;
  readonly toolCallId: string;
}

export function parseCopilotEvents(eventsJsonl: string): ParsedCopilotSession {
  const messages: Message[] = [];
  const meta: {
    sessionId: string;
    model: string;
    cwd: string;
    repository?: string;
    branch?: string;
    startedAt?: string;
  } = { sessionId: '', model: '', cwd: '' };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hasUsage = false;
  let startTimestamp: string | undefined;
  let endTimestamp: string | undefined;

  const toolCallsInProgress = new Map<string, ToolCallInProgress>();

  const lines = eventsJsonl.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const eventType = event.type as string | undefined;
    if (!eventType) continue;

    // All event payloads are nested under event.data
    const data = (event.data ?? {}) as Record<string, unknown>;

    switch (eventType) {
      case 'session.start': {
        meta.sessionId = String(data.sessionId ?? '');
        const ctx = data.context as Record<string, unknown> | undefined;
        meta.cwd = String(ctx?.cwd ?? '');
        meta.repository = ctx?.repository ? String(ctx.repository) : undefined;
        meta.branch = ctx?.branch ? String(ctx.branch) : undefined;
        // timestamp is at event top level; startTime is in data
        const ts = event.timestamp ?? data.startTime;
        meta.startedAt = ts ? String(ts) : undefined;
        startTimestamp = ts ? String(ts) : undefined;
        break;
      }

      case 'user.message': {
        messages.push({
          role: 'user',
          content: data.content != null ? String(data.content) : '',
        });
        break;
      }

      case 'assistant.message': {
        const toolRequests = data.toolRequests as readonly Record<string, unknown>[] | undefined;

        const toolCalls: ToolCall[] = (toolRequests ?? []).map((req) => ({
          tool: String(req.name ?? req.toolName ?? ''),
          input: req.arguments,
          id: req.toolCallId ? String(req.toolCallId) : undefined,
        }));

        messages.push({
          role: 'assistant',
          content: data.content != null ? String(data.content) : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
        break;
      }

      case 'skill.invoked': {
        const skillName = String(data.name ?? '');
        messages.push({
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Skill',
              input: { skill: skillName },
            },
          ],
        });
        break;
      }

      case 'tool.execution_start': {
        const toolCallId = String(data.toolCallId ?? '');
        if (toolCallId) {
          toolCallsInProgress.set(toolCallId, {
            toolName: String(data.toolName ?? ''),
            input: data.arguments,
            toolCallId,
          });
        }
        break;
      }

      case 'tool.execution_complete': {
        const toolCallId = String(data.toolCallId ?? '');
        const started = toolCallsInProgress.get(toolCallId);
        if (started) {
          toolCallsInProgress.delete(toolCallId);
          messages.push({
            role: 'assistant',
            toolCalls: [
              {
                tool: started.toolName,
                input: started.input,
                output: data.result,
                id: toolCallId,
              },
            ],
          });
        }
        break;
      }

      case 'session.shutdown': {
        endTimestamp = event.timestamp ? String(event.timestamp) : undefined;

        // Extract token usage from modelMetrics
        const modelMetrics = data.modelMetrics as
          | Record<string, { usage?: { inputTokens?: number; outputTokens?: number } }>
          | undefined;
        if (modelMetrics) {
          for (const metrics of Object.values(modelMetrics)) {
            if (metrics.usage) {
              hasUsage = true;
              totalInputTokens += Number(metrics.usage.inputTokens ?? 0);
              totalOutputTokens += Number(metrics.usage.outputTokens ?? 0);
            }
          }
        }

        // Extract model name from currentModel
        const currentModel = data.currentModel;
        if (currentModel && !meta.model) {
          meta.model = String(currentModel);
        }
        break;
      }
    }
  }

  let durationMs: number | undefined;
  if (startTimestamp && endTimestamp) {
    durationMs = new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  }

  return {
    messages,
    meta,
    tokenUsage: hasUsage ? { input: totalInputTokens, output: totalOutputTokens } : undefined,
    durationMs,
  };
}
