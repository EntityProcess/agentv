import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { formatFileContents } from '../formatting/segment-formatter.js';
import { cloneJsonObject } from '../input-message-utils.js';
import type { JsonObject, TestMessage } from '../types.js';
import { isJsonObject } from '../types.js';
import { resolveFileReference } from './file-resolver.js';

/**
 * Maps image file extensions to MIME types.
 * To add a new image format: add the extension (with leading dot) and its MIME type.
 */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

/**
 * Detect image MIME type from file extension.
 * Returns undefined for unsupported extensions.
 */
export function detectImageMediaType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MEDIA_TYPES[ext];
}

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

type ProcessMessagesOptions = {
  readonly messages: readonly TestMessage[];
  readonly searchRoots: readonly string[];
  readonly repoRootPath: string;
  readonly textParts?: string[];
  readonly messageType: 'input' | 'output';
  readonly verbose: boolean;
};

/**
 * Process message content into structured segments with file resolution.
 */
export async function processMessages(options: ProcessMessagesOptions): Promise<TestMessage[]> {
  const { messages, searchRoots, repoRootPath, textParts, messageType, verbose } = options;

  const processedMessages: TestMessage[] = [];

  for (const message of messages) {
    const content = message.content;
    if (typeof content === 'string') {
      if (textParts) {
        textParts.push(content);
      }
      processedMessages.push({ ...message, content });
      continue;
    }

    // Structured object content (real-world style payloads). Treat as a single text segment.
    // This keeps prompt building deterministic while preserving the full payload for code evaluators
    // via evalCase.input.
    if (isJsonObject(content)) {
      const rendered = JSON.stringify(content, null, 2);
      if (textParts) {
        textParts.push(rendered);
      }
      processedMessages.push({ ...message, content: cloneJsonObject(content) });
      continue;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    const processedContent: JsonObject[] = [];

    for (const rawSegment of content) {
      // Plain string items inside a content array are treated as inline text segments.
      // This matches the validator, which accepts string items alongside structured blocks.
      if (typeof rawSegment === 'string') {
        if (rawSegment.length > 0) {
          processedContent.push({ type: 'text', value: rawSegment });
          if (textParts) {
            textParts.push(rawSegment);
          }
        }
        continue;
      }

      if (!isJsonObject(rawSegment)) {
        continue;
      }

      const segmentType = asString(rawSegment.type);
      if (segmentType === 'file') {
        const rawValue = asString(rawSegment.value);
        if (!rawValue) {
          continue;
        }

        const { displayPath, resolvedPath, attempted } = await resolveFileReference(
          rawValue,
          searchRoots,
        );

        if (!resolvedPath) {
          const attempts = attempted.length
            ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
            : undefined;
          const context = messageType === 'input' ? '' : ' in expected_output';
          logWarning(`File not found${context}: ${displayPath}`, attempts);
          continue;
        }

        try {
          const fileContent = (await readFile(resolvedPath, 'utf8')).replace(/\r\n/g, '\n');

          processedContent.push({
            ...cloneJsonObject(rawSegment),
            path: displayPath,
            text: fileContent,
            resolvedPath: path.resolve(resolvedPath),
          });

          if (verbose) {
            const label = messageType === 'input' ? '[File]' : '[Expected Output File]';
            console.log(`  ${label} Found: ${displayPath}`);
            console.log(`    Resolved to: ${resolvedPath}`);
          }
        } catch (error) {
          const context = messageType === 'input' ? '' : ' expected output';
          logWarning(`Could not read${context} file ${resolvedPath}: ${(error as Error).message}`);
        }
        continue;
      }

      if (segmentType === 'image') {
        const rawValue = asString(rawSegment.value);
        if (!rawValue) {
          continue;
        }

        const { displayPath, resolvedPath, attempted } = await resolveFileReference(
          rawValue,
          searchRoots,
        );

        if (!resolvedPath) {
          const attempts = attempted.length
            ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
            : undefined;
          const context = messageType === 'input' ? '' : ' in expected_output';
          logWarning(`Image file not found${context}: ${displayPath}`, attempts);
          continue;
        }

        const mediaType = detectImageMediaType(resolvedPath);
        if (!mediaType) {
          logWarning(
            `Unsupported image extension for ${displayPath}. Supported: ${Object.keys(IMAGE_MEDIA_TYPES).join(', ')}`,
          );
          continue;
        }

        try {
          const imageBuffer = await readFile(resolvedPath);
          const base64 = imageBuffer.toString('base64');

          processedContent.push({
            type: 'image',
            media_type: mediaType,
            source: `data:${mediaType};base64,${base64}`,
          });

          if (verbose) {
            const label = messageType === 'input' ? '[Image]' : '[Expected Output Image]';
            console.log(`  ${label} Found: ${displayPath}`);
            console.log(`    Resolved to: ${resolvedPath} (${mediaType})`);
          }
        } catch (error) {
          const context = messageType === 'input' ? '' : ' expected output';
          logWarning(`Could not read${context} image ${resolvedPath}: ${(error as Error).message}`);
        }
        continue;
      }

      const clonedSegment = cloneJsonObject(rawSegment);
      processedContent.push(clonedSegment);
      const inlineValue = clonedSegment.value;
      if (typeof inlineValue === 'string' && textParts) {
        textParts.push(inlineValue);
      }
    }

    processedMessages.push({ ...message, content: processedContent });
  }

  return processedMessages;
}

/**
 * Resolve assistant content including file references.
 * Similar to input message processing, but for expected assistant responses.
 */
export async function resolveAssistantContent(
  content: TestMessage['content'] | undefined,
  searchRoots: readonly string[],
  verbose: boolean,
): Promise<string> {
  if (typeof content === 'string') {
    return content;
  }
  if (!content) {
    return '';
  }
  // Handle structured content object (e.g., { recommendation: ..., summary: ... })
  if (!Array.isArray(content)) {
    return JSON.stringify(content, null, 2);
  }

  // Track parts with metadata about whether they came from files
  const parts: Array<{ content: string; isFile: boolean; displayPath?: string }> = [];

  for (const entry of content) {
    if (typeof entry === 'string') {
      parts.push({ content: entry, isFile: false });
      continue;
    }

    if (!isJsonObject(entry)) {
      continue;
    }

    const segmentType = asString(entry.type);

    // Handle file references
    if (segmentType === 'file') {
      const rawValue = asString(entry.value);
      if (!rawValue) {
        continue;
      }

      const { displayPath, resolvedPath, attempted } = await resolveFileReference(
        rawValue,
        searchRoots,
      );

      if (!resolvedPath) {
        const attempts = attempted.length
          ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
          : undefined;
        logWarning(`File not found in expected_output: ${displayPath}`, attempts);
        continue;
      }

      try {
        const fileContent = (await readFile(resolvedPath, 'utf8')).replace(/\r\n/g, '\n').trim();
        parts.push({ content: fileContent, isFile: true, displayPath });
        if (verbose) {
          console.log(`  [Expected Assistant File] Found: ${displayPath}`);
          console.log(`    Resolved to: ${resolvedPath}`);
        }
      } catch (error) {
        logWarning(`Could not read file ${resolvedPath}: ${(error as Error).message}`);
      }
      continue;
    }

    // Handle text segments
    const textValue = asString(entry.text);
    if (typeof textValue === 'string') {
      parts.push({ content: textValue, isFile: false });
      continue;
    }

    const valueValue = asString(entry.value);
    if (typeof valueValue === 'string') {
      parts.push({ content: valueValue, isFile: false });
      continue;
    }

    parts.push({ content: JSON.stringify(entry), isFile: false });
  }

  return formatFileContents(parts);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function logWarning(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join('\n');
    console.warn(`${ANSI_YELLOW}Warning: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
  }
}

type ProcessExpectedMessagesOptions = {
  readonly messages: readonly TestMessage[];
  readonly searchRoots: readonly string[];
  readonly repoRootPath: string;
  readonly verbose: boolean;
};

/**
 * Extended message type for expected_output that may include tool_calls.
 */
type ExtendedTestMessage = TestMessage & {
  readonly name?: string;
  readonly tool_calls?: readonly JsonObject[];
};

/**
 * Process expected_output preserving full message structure including role and tool_calls.
 * Resolves file references and processes content.
 */
export async function processExpectedMessages(
  options: ProcessExpectedMessagesOptions,
): Promise<JsonObject[]> {
  const { messages, searchRoots, verbose } = options;
  const segments: JsonObject[] = [];

  for (const message of messages) {
    const extendedMessage = message as ExtendedTestMessage;
    const segment: Record<string, unknown> = {
      role: message.role,
    };

    // Preserve optional name field
    if (extendedMessage.name) {
      segment.name = extendedMessage.name;
    }

    // Process content
    const content = message.content;
    if (typeof content === 'string') {
      segment.content = content;
    } else if (Array.isArray(content)) {
      // Process content array, resolving file references
      const processedContent: JsonObject[] = [];
      for (const rawSegment of content) {
        // Plain string items are treated as inline text segments (matches validator).
        if (typeof rawSegment === 'string') {
          if (rawSegment.length > 0) {
            processedContent.push({ type: 'text', value: rawSegment });
          }
          continue;
        }

        if (!isJsonObject(rawSegment)) {
          continue;
        }

        const segmentType = asString(rawSegment.type);
        if (segmentType === 'file') {
          const rawValue = asString(rawSegment.value);
          if (!rawValue) {
            continue;
          }

          const { displayPath, resolvedPath, attempted } = await resolveFileReference(
            rawValue,
            searchRoots,
          );

          if (!resolvedPath) {
            const attempts = attempted.length
              ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
              : undefined;
            logWarning(`File not found in expected_output: ${displayPath}`, attempts);
            continue;
          }

          try {
            const fileContent = (await readFile(resolvedPath, 'utf8')).replace(/\r\n/g, '\n');
            processedContent.push({
              type: 'file',
              path: displayPath,
              text: fileContent,
              resolvedPath: path.resolve(resolvedPath),
            });

            if (verbose) {
              console.log(`  [Expected Output File] Found: ${displayPath}`);
              console.log(`    Resolved to: ${resolvedPath}`);
            }
          } catch (error) {
            logWarning(
              `Could not read expected output file ${resolvedPath}: ${(error as Error).message}`,
            );
          }
          continue;
        }

        if (segmentType === 'image') {
          const rawValue = asString(rawSegment.value);
          if (!rawValue) {
            continue;
          }

          const { displayPath, resolvedPath, attempted } = await resolveFileReference(
            rawValue,
            searchRoots,
          );

          if (!resolvedPath) {
            const attempts = attempted.length
              ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
              : undefined;
            logWarning(`Image file not found in expected_output: ${displayPath}`, attempts);
            continue;
          }

          const mediaType = detectImageMediaType(resolvedPath);
          if (!mediaType) {
            logWarning(
              `Unsupported image extension for ${displayPath}. Supported: ${Object.keys(IMAGE_MEDIA_TYPES).join(', ')}`,
            );
            continue;
          }

          try {
            const imageBuffer = await readFile(resolvedPath);
            const base64 = imageBuffer.toString('base64');
            processedContent.push({
              type: 'image',
              media_type: mediaType,
              source: `data:${mediaType};base64,${base64}`,
            });

            if (verbose) {
              console.log(`  [Expected Output Image] Found: ${displayPath}`);
              console.log(`    Resolved to: ${resolvedPath} (${mediaType})`);
            }
          } catch (error) {
            logWarning(
              `Could not read expected output image ${resolvedPath}: ${(error as Error).message}`,
            );
          }
          continue;
        }

        processedContent.push(cloneJsonObject(rawSegment));
      }
      segment.content = processedContent;
    } else if (isJsonObject(content)) {
      // Handle structured content object (e.g., { recommendation: ..., summary: ... })
      segment.content = cloneJsonObject(content);
    }

    // Preserve tool_calls if present
    if (extendedMessage.tool_calls && Array.isArray(extendedMessage.tool_calls)) {
      segment.tool_calls = extendedMessage.tool_calls.map((tc) =>
        isJsonObject(tc) ? cloneJsonObject(tc) : tc,
      );
    }

    segments.push(segment as JsonObject);
  }

  return segments;
}
