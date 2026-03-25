/**
 * Copilot CLI events.jsonl parser.
 *
 * Reads a Copilot CLI session transcript (events.jsonl) and converts it to
 * AgentV's Message[] format. Each line is a JSON object with a `type` field.
 *
 * Supported event types:
 *   session.start    → session metadata (sessionId, model, cwd)
 *   user.message     → Message { role: 'user' }
 *   assistant.message → Message { role: 'assistant', toolCalls from toolRequests }
 *   skill.invoked    → ToolCall { tool: 'Skill', input: { skill: name } }
 *   tool.execution_start + tool.execution_complete → ToolCall with output
 *   assistant.usage  → tokenUsage aggregation
 *   session.shutdown → session end timestamp
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
  let totalCost = 0;
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

    switch (eventType) {
      case 'session.start': {
        meta.sessionId = String(event.sessionId ?? '');
        meta.model = String(event.selectedModel ?? '');
        const ctx = event.context as Record<string, unknown> | undefined;
        meta.cwd = String(ctx?.cwd ?? '');
        meta.repository = ctx?.repository ? String(ctx.repository) : undefined;
        meta.branch = ctx?.branch ? String(ctx.branch) : undefined;
        meta.startedAt = event.timestamp ? String(event.timestamp) : undefined;
        startTimestamp = event.timestamp ? String(event.timestamp) : undefined;
        break;
      }

      case 'user.message': {
        messages.push({
          role: 'user',
          content: event.content != null ? String(event.content) : '',
        });
        break;
      }

      case 'assistant.message': {
        const toolRequests = event.toolRequests as
          | readonly { toolName: string; arguments?: unknown }[]
          | undefined;

        const toolCalls: ToolCall[] = (toolRequests ?? []).map((req) => ({
          tool: req.toolName,
          input: req.arguments,
        }));

        messages.push({
          role: 'assistant',
          content: event.content != null ? String(event.content) : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
        break;
      }

      case 'skill.invoked': {
        const skillName = String(event.name ?? '');
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
        const toolCallId = String(event.toolCallId ?? '');
        if (toolCallId) {
          toolCallsInProgress.set(toolCallId, {
            toolName: String(event.toolName ?? ''),
            input: event.arguments,
            toolCallId,
          });
        }
        break;
      }

      case 'tool.execution_complete': {
        const toolCallId = String(event.toolCallId ?? '');
        const started = toolCallsInProgress.get(toolCallId);
        if (started) {
          toolCallsInProgress.delete(toolCallId);
          messages.push({
            role: 'assistant',
            toolCalls: [
              {
                tool: started.toolName,
                input: started.input,
                output: event.result,
                id: toolCallId,
              },
            ],
          });
        }
        break;
      }

      case 'assistant.usage': {
        hasUsage = true;
        totalInputTokens += Number(event.inputTokens ?? 0);
        totalOutputTokens += Number(event.outputTokens ?? 0);
        totalCost += Number(event.cost ?? 0);
        break;
      }

      case 'session.shutdown': {
        endTimestamp = event.timestamp ? String(event.timestamp) : undefined;
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
    costUsd: hasUsage && totalCost > 0 ? totalCost : undefined,
    durationMs,
  };
}
