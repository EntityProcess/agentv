import { readFile } from "node:fs/promises";
import path from "node:path";

import { formatFileContents, formatSegment, hasVisibleContent } from "./segment-formatter.js";
import { isGuidelineFile } from "../loaders/config-loader.js";
import { fileExists } from "../loaders/file-resolver.js";
import type { ChatPrompt } from "../providers/types.js";
import type { EvalCase, JsonObject, TestMessage } from "../types.js";
import { isJsonObject } from "../types.js";

const ANSI_YELLOW = "\u001b[33m";
const ANSI_RESET = "\u001b[0m";

/**
 * Build prompt inputs by consolidating user request context and guideline content.
 */
export interface PromptInputs {
  readonly question: string;
  readonly guidelines: string;
  readonly chatPrompt?: ChatPrompt;
  readonly systemMessage?: string;
}

export async function buildPromptInputs(testCase: EvalCase): Promise<PromptInputs> {
  const guidelineParts: Array<{ content: string; isFile: boolean; displayPath?: string }> = [];
  for (const rawPath of testCase.guideline_paths) {
    const absolutePath = path.resolve(rawPath);
    if (!(await fileExists(absolutePath))) {
      logWarning(`Could not read guideline file ${absolutePath}: file does not exist`);
      continue;
    }

    try {
      const content = (await readFile(absolutePath, "utf8")).replace(/\r\n/g, "\n").trim();
      guidelineParts.push({
        content,
        isFile: true,
        displayPath: path.basename(absolutePath)
      });
    } catch (error) {
      logWarning(`Could not read guideline file ${absolutePath}: ${(error as Error).message}`);
    }
  }

  const guidelines = formatFileContents(guidelineParts);

  // Build segments per message to determine if role markers are needed
  const segmentsByMessage: JsonObject[][] = [];
  const fileContentsByPath = new Map<string, string>();
  for (const segment of testCase.input_segments) {
    if (segment.type === "file" && typeof segment.path === "string" && typeof segment.text === "string") {
      fileContentsByPath.set(segment.path, segment.text);
    }
  }
  
  for (const message of testCase.input_messages) {
    const messageSegments: JsonObject[] = [];
    
    if (typeof message.content === "string") {
      if (message.content.trim().length > 0) {
        messageSegments.push({ type: "text", value: message.content });
      }
    } else if (Array.isArray(message.content)) {
      for (const segment of message.content) {
        if (typeof segment === "string") {
          if (segment.trim().length > 0) {
            messageSegments.push({ type: "text", value: segment });
          }
        } else if (isJsonObject(segment)) {
          const type = asString(segment.type);
          
          if (type === "file") {
            const value = asString(segment.value);
            if (!value) continue;
            
            // Check if this is a guideline file (extracted separately)
            if (testCase.guideline_patterns && isGuidelineFile(value, testCase.guideline_patterns)) {
              // Reference marker only - actual content is in guidelines field
              messageSegments.push({ type: "guideline_ref", path: value });
              continue;
            }
            
            // Find the file content from input_segments
            const fileText = fileContentsByPath.get(value);
            
            if (fileText !== undefined) {
              messageSegments.push({ type: "file", text: fileText, path: value });
            }
          } else if (type === "text") {
            const textValue = asString(segment.value);
            if (textValue && textValue.trim().length > 0) {
              messageSegments.push({ type: "text", value: textValue });
            }
          }
        }
      }
    }
    
    segmentsByMessage.push(messageSegments);
  }

  // Determine if we need role markers based on actual processed content
  const useRoleMarkers = needsRoleMarkers(testCase.input_messages, segmentsByMessage);

  let question: string;
  
  if (useRoleMarkers) {
    // Multi-turn format with role markers using pre-computed segments
    const messageParts: string[] = [];
    
    for (let i = 0; i < testCase.input_messages.length; i++) {
      const message = testCase.input_messages[i];
      const segments = segmentsByMessage[i];
      
      if (!hasVisibleContent(segments)) {
        continue;
      }
      
      const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
      const contentParts: string[] = [];
      
      for (const segment of segments) {
        const formattedContent = formatSegment(segment);
        if (formattedContent) {
          contentParts.push(formattedContent);
        }
      }
      
      if (contentParts.length > 0) {
        const messageContent = contentParts.join("\n");
        messageParts.push(`@[${roleLabel}]:\n${messageContent}`);
      }
    }
    
    question = messageParts.join("\n\n");
  } else {
    // Single-turn flat format
    const questionParts: string[] = [];
    for (const segment of testCase.input_segments) {
      const formattedContent = formatSegment(segment);
      if (formattedContent) {
        questionParts.push(formattedContent);
      }
    }

    if (testCase.code_snippets.length > 0) {
      questionParts.push(testCase.code_snippets.join("\n"));
    }

    question = questionParts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join("\n\n");
  }

  const chatPrompt = useRoleMarkers
    ? buildChatPromptFromSegments({
        messages: testCase.input_messages,
        segmentsByMessage,
        guidelinePatterns: testCase.guideline_patterns,
        guidelineContent: guidelines,
      })
    : undefined;

  return { question, guidelines, chatPrompt };
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
  if (messages.some((msg) => msg.role === "assistant" || msg.role === "tool")) {
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
  readonly guidelinePatterns?: readonly string[];
  readonly guidelineContent?: string;
  readonly systemPrompt?: string;
}): ChatPrompt | undefined {
  const { messages, segmentsByMessage, guidelinePatterns, guidelineContent, systemPrompt } = options;

  if (messages.length === 0) {
    return undefined;
  }

  const systemSegments: string[] = [];

  if (systemPrompt && systemPrompt.trim().length > 0) {
    systemSegments.push(systemPrompt.trim());
  }

  if (guidelineContent && guidelineContent.trim().length > 0) {
    systemSegments.push(`[[ ## Guidelines ## ]]\n\n${guidelineContent.trim()}`);
  }

  let startIndex = 0;
  while (startIndex < messages.length && messages[startIndex].role === "system") {
    const segments = segmentsByMessage[startIndex];
    const contentParts: string[] = [];

    for (const segment of segments) {
      const formatted = formatSegment(segment);
      if (formatted) {
        contentParts.push(formatted);
      }
    }

    if (contentParts.length > 0) {
      systemSegments.push(contentParts.join("\n"));
    }

    startIndex += 1;
  }

  const chatPrompt: ChatPrompt = [];

  if (systemSegments.length > 0) {
    chatPrompt.push({
      role: "system",
      content: systemSegments.join("\n\n"),
    });
  }

  for (let i = startIndex; i < messages.length; i++) {
    const message = messages[i];
    const segments = segmentsByMessage[i];
    const contentParts: string[] = [];

    let role: string = message.role;
    let name: string | undefined;

    if (role === "system") {
      role = "assistant";
      contentParts.push("@[System]:");
    } else if (role === "tool") {
      // Map 'tool' to 'function' for Ax compatibility
      role = "function";
      name = "tool";
    }

    for (const segment of segments) {
      if (segment.type === "guideline_ref") {
        continue;
      }
      const formatted = formatSegment(segment);
      if (formatted) {
        const isGuidelineRef =
          segment.type === "file" &&
          typeof segment.path === "string" &&
          guidelinePatterns &&
          isGuidelineFile(segment.path, guidelinePatterns);

        if (isGuidelineRef) {
          continue;
        }

        contentParts.push(formatted);
      }
    }

    if (contentParts.length === 0) {
      continue;
    }

    chatPrompt.push({
      role: role,
      content: contentParts.join("\n"),
      ...(name ? { name } : {}),
    } as unknown as ChatPrompt[number]);
  }

  return chatPrompt.length > 0 ? chatPrompt : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function logWarning(message: string): void {
  console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
}
