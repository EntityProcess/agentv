import type { ChatMessageRole, ChatPrompt } from '../providers/types.js';
import type { EvalTest, JsonObject, TestMessage } from '../types.js';
import { isJsonObject } from '../types.js';
import {
  type FormattingMode,
  formatSegment,
  hasVisibleContent,
} from './segment-formatter.js';

/**
 * Build prompt inputs by consolidating user request context.
 */
export interface PromptInputs {
  readonly question: string;
  readonly chatPrompt?: ChatPrompt;
  readonly systemMessage?: string;
}

/**
 * Build prompt inputs by consolidating user request context.
 *
 * @param testCase - The evaluation test case
 * @param mode - Formatting mode: 'agent' for file references, 'lm' for embedded content (default: 'lm')
 */
export async function buildPromptInputs(
  testCase: EvalTest,
  mode: FormattingMode = 'lm',
): Promise<PromptInputs> {
  // Build segments per message to determine if role markers are needed
  const segmentsByMessage: JsonObject[][] = [];
  const fileContentsByPath = new Map<string, string>();
  for (const segment of testCase.input_segments) {
    if (
      segment.type === 'file' &&
      typeof segment.path === 'string' &&
      typeof segment.text === 'string'
    ) {
      fileContentsByPath.set(segment.path, segment.text);
    }
  }

  for (const message of testCase.input) {
    const messageSegments: JsonObject[] = [];

    if (typeof message.content === 'string') {
      if (message.content.trim().length > 0) {
        messageSegments.push({ type: 'text', value: message.content });
      }
    } else if (Array.isArray(message.content)) {
      for (const segment of message.content) {
        if (typeof segment === 'string') {
          if (segment.trim().length > 0) {
            messageSegments.push({ type: 'text', value: segment });
          }
        } else if (isJsonObject(segment)) {
          const type = asString(segment.type);

          if (type === 'file') {
            const value = asString(segment.value);
            if (!value) continue;

            // Find the file content from input_segments
            const fileText = fileContentsByPath.get(value);

            if (fileText !== undefined) {
              messageSegments.push({ type: 'file', text: fileText, path: value });
            }
          } else if (type === 'text') {
            const textValue = asString(segment.value);
            if (textValue && textValue.trim().length > 0) {
              messageSegments.push({ type: 'text', value: textValue });
            }
          }
        }
      }
    } else if (isJsonObject(message.content)) {
      const rendered = JSON.stringify(message.content, null, 2);
      if (rendered.trim().length > 0) {
        messageSegments.push({ type: 'text', value: rendered });
      }
    }

    segmentsByMessage.push(messageSegments);
  }

  // Determine if we need role markers based on actual processed content
  const useRoleMarkers = needsRoleMarkers(testCase.input, segmentsByMessage);

  let question: string;

  if (useRoleMarkers) {
    // Multi-turn format with role markers using pre-computed segments
    const messageParts: string[] = [];

    for (let i = 0; i < testCase.input.length; i++) {
      const message = testCase.input[i];
      const segments = segmentsByMessage[i];

      if (!hasVisibleContent(segments)) {
        continue;
      }

      const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
      const contentParts: string[] = [];

      for (const segment of segments) {
        const formattedContent = formatSegment(segment, mode);
        if (formattedContent) {
          contentParts.push(formattedContent);
        }
      }

      if (contentParts.length > 0) {
        const messageContent = contentParts.join('\n');
        messageParts.push(`@[${roleLabel}]:\n${messageContent}`);
      }
    }

    question = messageParts.join('\n\n');
  } else {
    // Single-turn flat format
    const questionParts: string[] = [];
    for (const segment of testCase.input_segments) {
      const formattedContent = formatSegment(segment, mode);
      if (formattedContent) {
        questionParts.push(formattedContent);
      }
    }

    question = questionParts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join('\n\n');
  }

  const chatPrompt = useRoleMarkers
    ? buildChatPromptFromSegments({
        messages: testCase.input,
        segmentsByMessage,
        mode,
      })
    : undefined;

  // Both question (flat string) and chatPrompt (structured messages) are returned:
  // chatPrompt is used for the API call, question is retained for logging/debugging.
  return { question, chatPrompt };
}

/**
 * Detect if role markers are needed based on conversational structure.
 *
 * Role markers ([System]:, [User]:, etc.) are added when:
 * 1. There are assistant/tool messages (true multi-turn conversation), OR
 * 2. There are multiple messages that will produce visible content in the formatted output
 */
function needsRoleMarkers(
  messages: readonly TestMessage[],
  processedSegmentsByMessage: readonly (readonly JsonObject[])[],
): boolean {
  // Check for multi-turn conversation (assistant/tool messages)
  if (messages.some((msg) => msg.role === 'assistant' || msg.role === 'tool')) {
    return true;
  }

  // Count how many messages have actual content after processing
  let messagesWithContent = 0;

  for (const segments of processedSegmentsByMessage) {
    if (hasVisibleContent(segments)) {
      messagesWithContent++;
    }
  }

  return messagesWithContent > 1;
}

function buildChatPromptFromSegments(options: {
  readonly messages: readonly TestMessage[];
  readonly segmentsByMessage: readonly JsonObject[][];
  readonly systemPrompt?: string;
  readonly mode?: FormattingMode;
}): ChatPrompt | undefined {
  const {
    messages,
    segmentsByMessage,
    systemPrompt,
    mode = 'lm',
  } = options;

  if (messages.length === 0) {
    return undefined;
  }

  const systemSegments: string[] = [];

  if (systemPrompt && systemPrompt.trim().length > 0) {
    systemSegments.push(systemPrompt.trim());
  }

  let startIndex = 0;
  while (startIndex < messages.length && messages[startIndex].role === 'system') {
    const segments = segmentsByMessage[startIndex];
    const contentParts: string[] = [];

    for (const segment of segments) {
      const formatted = formatSegment(segment, mode);
      if (formatted) {
        contentParts.push(formatted);
      }
    }

    if (contentParts.length > 0) {
      systemSegments.push(contentParts.join('\n'));
    }

    startIndex += 1;
  }

  const chatPrompt: Array<ChatPrompt[number]> = [];

  if (systemSegments.length > 0) {
    chatPrompt.push({
      role: 'system',
      content: systemSegments.join('\n\n'),
    });
  }

  for (let i = startIndex; i < messages.length; i++) {
    const message = messages[i];
    const segments = segmentsByMessage[i];
    const contentParts: string[] = [];

    let role: ChatMessageRole = message.role as ChatMessageRole;

    if (role === 'system') {
      role = 'assistant';
      contentParts.push('@[System]:');
    } else if (role === 'tool') {
      role = 'assistant';
      contentParts.push('@[Tool]:');
    }

    for (const segment of segments) {
      const formatted = formatSegment(segment, mode);
      if (formatted) {
        contentParts.push(formatted);
      }
    }

    if (contentParts.length === 0) {
      continue;
    }

    const content = contentParts.join('\n');

    chatPrompt.push({
      role,
      content,
    });
  }

  return chatPrompt.length > 0 ? (chatPrompt as ChatPrompt) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

