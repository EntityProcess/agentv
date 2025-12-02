import micromatch from "micromatch";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { buildDirectoryChain, buildSearchRoots, resolveFileReference } from "./file-utils.js";
import type { ChatPrompt } from "./providers/types.js";
import type {
  EvaluatorConfig,
  EvaluatorKind,
  JsonObject,
  JsonValue,
  EvalCase,
  TestMessage,
} from "./types.js";
import { isEvaluatorKind, isJsonObject, isTestMessage } from "./types.js";

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const ANSI_YELLOW = "\u001b[33m";
const ANSI_RESET = "\u001b[0m";
const SCHEMA_EVAL_V2 = "agentv-eval-v2";
const SCHEMA_CONFIG_V2 = "agentv-config-v2";

type AgentVConfig = {
  readonly $schema?: JsonValue;
  readonly guideline_patterns?: readonly string[];
};

/**
 * Read metadata from a test suite file (like target name).
 * This is a convenience function for CLI tools that need metadata without loading all eval cases.
 */
export async function readTestSuiteMetadata(testFilePath: string): Promise<{ target?: string }> {
  try {
    const absolutePath = path.resolve(testFilePath);
    const content = await readFile(absolutePath, "utf8");
    const parsed = parse(content) as unknown;
    
    if (!isJsonObject(parsed)) {
      return {};
    }
    
    return { target: extractTargetFromSuite(parsed) };
  } catch {
    return {};
  }
}

/**
 * Extract target name from parsed eval suite (checks execution.target then falls back to root-level target).
 */
function extractTargetFromSuite(suite: JsonObject): string | undefined {
  // Check execution.target first (new location), fallback to root-level target (legacy)
  const execution = suite.execution;
  if (execution && typeof execution === "object" && !Array.isArray(execution)) {
    const executionTarget = (execution as Record<string, unknown>).target;
    if (typeof executionTarget === "string" && executionTarget.trim().length > 0) {
      return executionTarget.trim();
    }
  }
  
  // Fallback to legacy root-level target
  const targetValue = suite.target;
  if (typeof targetValue === "string" && targetValue.trim().length > 0) {
    return targetValue.trim();
  }
  
  return undefined;
}

/**
 * Load optional .agentv/config.yaml configuration file.
 * Searches from eval file directory up to repo root.
 */
async function loadConfig(evalFilePath: string, repoRoot: string): Promise<AgentVConfig | null> {
  const directories = buildDirectoryChain(evalFilePath, repoRoot);
  
  for (const directory of directories) {
    const configPath = path.join(directory, ".agentv", "config.yaml");
    
    if (!(await fileExists(configPath))) {
      continue;
    }
    
    try {
      const rawConfig = await readFile(configPath, "utf8");
      const parsed = parse(rawConfig) as unknown;
      
      if (!isJsonObject(parsed)) {
        logWarning(`Invalid .agentv/config.yaml format at ${configPath}`);
        continue;
      }
      
      const config = parsed as AgentVConfig;
      
      // Check $schema field to ensure V2 format
      const schema = config.$schema;
      
      if (schema !== SCHEMA_CONFIG_V2) {
        const message = typeof schema === 'string' 
          ? `Invalid $schema value '${schema}' in ${configPath}. Expected '${SCHEMA_CONFIG_V2}'`
          : `Missing required field '$schema' in ${configPath}.\nPlease add '$schema: ${SCHEMA_CONFIG_V2}' at the top of the file.`;
        logWarning(message);
        continue;
      }
      
      const guidelinePatterns = config.guideline_patterns;
      if (guidelinePatterns !== undefined && !Array.isArray(guidelinePatterns)) {
        logWarning(`Invalid guideline_patterns in ${configPath}, expected array`);
        continue;
      }
      
      if (Array.isArray(guidelinePatterns) && !guidelinePatterns.every((p) => typeof p === "string")) {
        logWarning(`Invalid guideline_patterns in ${configPath}, all entries must be strings`);
        continue;
      }
      
      return {
        guideline_patterns: guidelinePatterns as readonly string[] | undefined,
      };
    } catch (error) {
      logWarning(`Could not read .agentv/config.yaml at ${configPath}: ${(error as Error).message}`);
      continue;
    }
  }
  
  return null;
}

/**
 * Determine whether a path references guideline content (instructions or prompts).
 */
export function isGuidelineFile(filePath: string, patterns?: readonly string[]): boolean {
  const normalized = filePath.split("\\").join("/");
  const patternsToUse = patterns ?? [];
  
  return micromatch.isMatch(normalized, patternsToUse as string[]);
}

/**
 * Extract fenced code blocks from AgentV user segments.
 */
export function extractCodeBlocks(segments: readonly JsonObject[]): readonly string[] {
  const codeBlocks: string[] = [];
  for (const segment of segments) {
    const typeValue = segment["type"];
    if (typeof typeValue !== "string" || typeValue !== "text") {
      continue;
    }
    const textValue = segment["value"];
    if (typeof textValue !== "string") {
      continue;
    }
    const matches = textValue.match(CODE_BLOCK_PATTERN);
    if (matches) {
      codeBlocks.push(...matches);
    }
  }
  return codeBlocks;
}

type LoadOptions = {
  readonly verbose?: boolean;
  readonly evalId?: string;
};

type RawTestSuite = JsonObject & {
  readonly $schema?: JsonValue;
  readonly evalcases?: JsonValue;
  readonly target?: JsonValue;
  readonly execution?: JsonValue;
  readonly dataset?: JsonValue;
};

type RawEvalCase = JsonObject & {
  readonly id?: JsonValue;
  readonly conversation_id?: JsonValue;
  readonly outcome?: JsonValue;
  readonly input_messages?: JsonValue;
  readonly expected_messages?: JsonValue;
  readonly execution?: JsonValue;
  readonly evaluators?: JsonValue;
};

/**
 * Process message content into structured segments with file resolution.
 */
async function processMessages(options: {
  readonly messages: readonly TestMessage[];
  readonly searchRoots: readonly string[];
  readonly repoRootPath: string;
  readonly guidelinePatterns?: readonly string[];
  readonly guidelinePaths?: string[];
  readonly textParts?: string[];
  readonly messageType: "input" | "output";
  readonly verbose: boolean;
}): Promise<JsonObject[]> {
  const {
    messages,
    searchRoots,
    repoRootPath,
    guidelinePatterns,
    guidelinePaths,
    textParts,
    messageType,
    verbose,
  } = options;

  const segments: JsonObject[] = [];

  for (const message of messages) {
    const content = message.content;
    if (typeof content === "string") {
      segments.push({ type: "text", value: content });
      if (textParts) {
        textParts.push(content);
      }
      continue;
    }

    for (const rawSegment of content) {
      if (!isJsonObject(rawSegment)) {
        continue;
      }

      const segmentType = asString(rawSegment.type);
      if (segmentType === "file") {
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
            ? ["  Tried:", ...attempted.map((candidate) => `    ${candidate}`)]
            : undefined;
          const context = messageType === "input" ? "" : " in expected_messages";
          logWarning(`File not found${context}: ${displayPath}`, attempts);
          continue;
        }

        try {
          const fileContent = (await readFile(resolvedPath, "utf8")).replace(/\r\n/g, "\n");

          // Only check for guidelines in input messages
          if (messageType === "input" && guidelinePatterns && guidelinePaths) {
            const relativeToRepo = path.relative(repoRootPath, resolvedPath);

            if (isGuidelineFile(relativeToRepo, guidelinePatterns)) {
              guidelinePaths.push(path.resolve(resolvedPath));
              if (verbose) {
                console.log(`  [Guideline] Found: ${displayPath}`);
                console.log(`    Resolved to: ${resolvedPath}`);
              }
              continue;
            }
          }

          segments.push({
            type: "file",
            path: displayPath,
            text: fileContent,
            resolvedPath: path.resolve(resolvedPath),
          });

          if (verbose) {
            const label = messageType === "input" ? "[File]" : "[Expected Output File]";
            console.log(`  ${label} Found: ${displayPath}`);
            console.log(`    Resolved to: ${resolvedPath}`);
          }
        } catch (error) {
          const context = messageType === "input" ? "" : " expected output";
          logWarning(`Could not read${context} file ${resolvedPath}: ${(error as Error).message}`);
        }
        continue;
      }

      const clonedSegment = cloneJsonObject(rawSegment);
      segments.push(clonedSegment);
      const inlineValue = clonedSegment.value;
      if (typeof inlineValue === "string" && textParts) {
        textParts.push(inlineValue);
      }
    }
  }

  return segments;
}

/**
 * Load eval cases from a AgentV YAML specification file.
 */
export async function loadEvalCases(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<readonly EvalCase[]> {
  const verbose = options?.verbose ?? false;
  const evalIdFilter = options?.evalId;
  const absoluteTestPath = path.resolve(evalFilePath);
  if (!(await fileExists(absoluteTestPath))) {
    throw new Error(`Test file not found: ${evalFilePath}`);
  }

  const repoRootPath = resolveToAbsolutePath(repoRoot);
  const searchRoots = buildSearchRoots(absoluteTestPath, repoRootPath);

  // Load configuration (walks up directory tree to repo root)
  const config = await loadConfig(absoluteTestPath, repoRootPath);
  const guidelinePatterns = config?.guideline_patterns;

  const rawFile = await readFile(absoluteTestPath, "utf8");
  const parsed = parse(rawFile) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(`Invalid test file format: ${evalFilePath}`);
  }

  const suite = parsed as RawTestSuite;
  const datasetNameFromSuite = asString(suite.dataset)?.trim();
  const fallbackDataset = path.basename(absoluteTestPath).replace(/\.ya?ml$/i, "") || "eval";
  const datasetName =
    datasetNameFromSuite && datasetNameFromSuite.length > 0 ? datasetNameFromSuite : fallbackDataset;
  
  // Check $schema field to ensure V2 format
  const schema = suite.$schema;
  
  if (schema !== SCHEMA_EVAL_V2) {
    const message = typeof schema === 'string' 
      ? `Invalid $schema value '${schema}' in ${evalFilePath}. Expected '${SCHEMA_EVAL_V2}'`
      : `Missing required field '$schema' in ${evalFilePath}.\nPlease add '$schema: ${SCHEMA_EVAL_V2}' at the top of the file.`;
    throw new Error(message);
  }
  
  // V2 format: $schema is agentv-eval-v2
  const rawTestcases = suite.evalcases;
  if (!Array.isArray(rawTestcases)) {
    throw new Error(`Invalid test file format: ${evalFilePath} - missing 'evalcases' field`);
  }

  const globalEvaluator = coerceEvaluator(suite.evaluator, "global") ?? "llm_judge";
  
  // Extract global target from execution.target (or legacy root-level target)
  const globalExecution = isJsonObject(suite.execution) ? suite.execution : undefined;
  const globalTarget = asString(globalExecution?.target) ?? asString(suite.target);
  
  const results: EvalCase[] = [];

  for (const rawEvalcase of rawTestcases) {
    if (!isJsonObject(rawEvalcase)) {
      logWarning("Skipping invalid eval case entry (expected object)");
      continue;
    }

    const evalcase = rawEvalcase as RawEvalCase;
    const id = asString(evalcase.id);
    
    // Skip eval cases that don't match the filter
    if (evalIdFilter && id !== evalIdFilter) {
      continue;
    }
    
    const conversationId = asString(evalcase.conversation_id);
    const outcome = asString(evalcase.outcome);
    
    const inputMessagesValue = evalcase.input_messages;
    const expectedMessagesValue = evalcase.expected_messages;

    if (!id || !outcome || !Array.isArray(inputMessagesValue)) {
      logWarning(`Skipping incomplete eval case: ${id ?? "unknown"}`);
      continue;
    }
    
    // expected_messages is optional - for outcome-only evaluation
    const hasExpectedMessages = Array.isArray(expectedMessagesValue) && expectedMessagesValue.length > 0;

    // V2 format: input_messages vs expected_messages
    const inputMessages = inputMessagesValue.filter((msg): msg is TestMessage => isTestMessage(msg));
    const expectedMessages = hasExpectedMessages 
      ? expectedMessagesValue.filter((msg): msg is TestMessage => isTestMessage(msg))
      : [];
    
    if (hasExpectedMessages && expectedMessages.length === 0) {
      logWarning(`No valid expected message found for eval case: ${id}`);
      continue;
    }

    if (expectedMessages.length > 1) {
      logWarning(`Multiple expected messages found for eval case: ${id}, using first`);
    }

    const guidelinePaths: string[] = [];
    const inputTextParts: string[] = [];

    // Process all input messages to extract files and guidelines
    const inputSegments = await processMessages({
      messages: inputMessages,
      searchRoots,
      repoRootPath,
      guidelinePatterns,
      guidelinePaths,
      textParts: inputTextParts,
      messageType: "input",
      verbose,
    });

    // Process expected_messages into segments (only if provided)
    const outputSegments = hasExpectedMessages
      ? await processMessages({
          messages: expectedMessages,
          searchRoots,
          repoRootPath,
          guidelinePatterns,
          messageType: "output",
          verbose,
        })
      : [];

    const codeSnippets = extractCodeBlocks(inputSegments);
    const expectedContent = expectedMessages[0]?.content;
    const referenceAnswer = expectedContent 
      ? await resolveAssistantContent(expectedContent, searchRoots, verbose)
      : "";
    const question = inputTextParts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(" ");

    const evalCaseEvaluatorKind = coerceEvaluator(evalcase.evaluator, id) ?? globalEvaluator;
    const evaluators = await parseEvaluators(evalcase, globalExecution, searchRoots, id ?? "unknown");

    // Extract file paths from all input segments (non-guideline files)
    const userFilePaths: string[] = [];
    for (const segment of inputSegments) {
      if (segment.type === "file" && typeof segment.resolvedPath === "string") {
        userFilePaths.push(segment.resolvedPath);
      }
    }

    // Combine all file paths (guidelines + regular files)
    const allFilePaths = [
      ...guidelinePaths.map((guidelinePath) => path.resolve(guidelinePath)),
      ...userFilePaths,
    ];

    const testCase: EvalCase = {
      id,
      dataset: datasetName,
      conversation_id: conversationId,
      question: question,
      input_messages: inputMessages,
      input_segments: inputSegments,
      output_segments: outputSegments,
      reference_answer: referenceAnswer,
      guideline_paths: guidelinePaths.map((guidelinePath) => path.resolve(guidelinePath)),
      guideline_patterns: guidelinePatterns,
      file_paths: allFilePaths,
      code_snippets: codeSnippets,
      expected_outcome: outcome,
      evaluator: evalCaseEvaluatorKind,
      evaluators,
    };

    if (verbose) {
      console.log(`\n[Eval Case: ${id}]`);
      if (testCase.guideline_paths.length > 0) {
        console.log(`  Guidelines used: ${testCase.guideline_paths.length}`);
        for (const guidelinePath of testCase.guideline_paths) {
          console.log(`    - ${guidelinePath}`);
        }
      } else {
        console.log("  No guidelines found");
      }
    }

    results.push(testCase);
  }

  return results;
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

/**
 * Check if processed segments contain visible content (text or file attachments).
 */
function hasVisibleContent(segments: readonly JsonObject[]): boolean {
  return segments.some((segment) => {
    const type = asString(segment.type);
    
    if (type === "text") {
      const value = asString(segment.value);
      return value !== undefined && value.trim().length > 0;
    }

    if (type === "guideline_ref") {
      return false;
    }
    
    if (type === "file") {
      const text = asString(segment.text);
      return text !== undefined && text.trim().length > 0;
    }
    
    return false;
  });
}

/**
 * Format a segment into its display string.
 * Text segments return their value; file segments return formatted file content with header.
 */
function formatSegment(segment: JsonObject): string | undefined {
  const type = asString(segment.type);
  
  if (type === "text") {
    return asString(segment.value);
  }

  if (type === "guideline_ref") {
    const refPath = asString(segment.path);
    return refPath ? `<Attached: ${refPath}>` : undefined;
  }
  
  if (type === "file") {
    const text = asString(segment.text);
    const filePath = asString(segment.path);
    if (text && filePath) {
      return `=== ${filePath} ===\n${text}`;
    }
  }
  
  return undefined;
}

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
  const guidelineContents: string[] = [];
  for (const rawPath of testCase.guideline_paths) {
    const absolutePath = path.resolve(rawPath);
    if (!(await fileExists(absolutePath))) {
      logWarning(`Could not read guideline file ${absolutePath}: file does not exist`);
      continue;
    }

    try {
      const content = (await readFile(absolutePath, "utf8")).replace(/\r\n/g, "\n");
      guidelineContents.push(`=== ${path.basename(absolutePath)} ===\n${content}`);
    } catch (error) {
      logWarning(`Could not read guideline file ${absolutePath}: ${(error as Error).message}`);
    }
  }

  const guidelines = guidelineContents
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");

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

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveToAbsolutePath(candidate: URL | string): string {
  if (candidate instanceof URL) {
    return fileURLToPath(candidate);
  }
  if (typeof candidate === "string") {
    if (candidate.startsWith("file://")) {
      return fileURLToPath(new URL(candidate));
    }
    return path.resolve(candidate);
  }
  throw new TypeError("Unsupported repoRoot value. Expected string or URL.");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function cloneJsonObject(source: JsonObject): JsonObject {
  const entries = Object.entries(source).map(([key, value]) => [key, cloneJsonValue(value)]);
  return Object.fromEntries(entries) as JsonObject;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as readonly JsonValue[];
  }
  return cloneJsonObject(value as JsonObject);
}

/**
 * Resolve assistant content including file references.
 * Similar to input message processing, but for expected assistant responses.
 */
async function resolveAssistantContent(
  content: TestMessage["content"] | undefined,
  searchRoots: readonly string[],
  verbose: boolean,
): Promise<string> {
  if (typeof content === "string") {
    return content;
  }
  if (!content) {
    return "";
  }
  
  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry === "string") {
      parts.push(entry);
      continue;
    }
    
    if (!isJsonObject(entry)) {
      continue;
    }
    
    const segmentType = asString(entry.type);
    
    // Handle file references
    if (segmentType === "file") {
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
          ? ["  Tried:", ...attempted.map((candidate) => `    ${candidate}`)]
          : undefined;
        logWarning(`File not found in expected_messages: ${displayPath}`, attempts);
        continue;
      }
      
      try {
        const fileContent = (await readFile(resolvedPath, "utf8")).replace(/\r\n/g, "\n");
        parts.push(fileContent);
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
    if (typeof textValue === "string") {
      parts.push(textValue);
      continue;
    }
    
    const valueValue = asString(entry.value);
    if (typeof valueValue === "string") {
      parts.push(valueValue);
      continue;
    }
    
    parts.push(JSON.stringify(entry));
  }
  return parts.join(" ");
}

async function parseEvaluators(
  rawEvalCase: RawEvalCase,
  globalExecution: JsonObject | undefined,
  searchRoots: readonly string[],
  evalId: string,
): Promise<readonly EvaluatorConfig[] | undefined> {
  const execution = rawEvalCase.execution;
  // Priority: case-level execution.evaluators > case-level evaluators > global execution.evaluators
  const candidateEvaluators = isJsonObject(execution) 
    ? execution.evaluators ?? rawEvalCase.evaluators 
    : rawEvalCase.evaluators ?? globalExecution?.evaluators;
  if (candidateEvaluators === undefined) {
    return undefined;
  }

  if (!Array.isArray(candidateEvaluators)) {
    logWarning(`Skipping evaluators for '${evalId}': expected array`);
    return undefined;
  }

  const evaluators: EvaluatorConfig[] = [];

  for (const rawEvaluator of candidateEvaluators) {
    if (!isJsonObject(rawEvaluator)) {
      logWarning(`Skipping invalid evaluator entry for '${evalId}' (expected object)`);
      continue;
    }

    const name = asString(rawEvaluator.name);
    const typeValue = rawEvaluator.type;

    if (!name || !isEvaluatorKind(typeValue)) {
      logWarning(`Skipping evaluator with invalid name/type in '${evalId}'`);
      continue;
    }

    if (typeValue === "code") {
      const script = asString(rawEvaluator.script);
      if (!script) {
        logWarning(`Skipping code evaluator '${name}' in '${evalId}': missing script`);
        continue;
      }

      const cwd = asString(rawEvaluator.cwd);
      let resolvedCwd: string | undefined;

      // Resolve cwd if provided (relative to eval file)
      if (cwd) {
        const resolved = await resolveFileReference(cwd, searchRoots);
        if (resolved.resolvedPath) {
          resolvedCwd = path.resolve(resolved.resolvedPath);
        } else {
          logWarning(
            `Code evaluator '${name}' in '${evalId}': cwd not found (${resolved.displayPath})`,
            resolved.attempted.length > 0 ? resolved.attempted.map((attempt) => `  Tried: ${attempt}`) : undefined,
          );
        }
      }

      evaluators.push({
        name,
        type: "code",
        script,
        cwd,
        resolvedCwd,
      });
      continue;
    }

    const prompt = asString(rawEvaluator.prompt);
    let promptPath: string | undefined;
    if (prompt) {
      const resolved = await resolveFileReference(prompt, searchRoots);
      if (resolved.resolvedPath) {
        promptPath = path.resolve(resolved.resolvedPath);
      } else {
        logWarning(
          `Inline prompt used for evaluator '${name}' in '${evalId}' (file not found: ${resolved.displayPath})`,
          resolved.attempted.length > 0 ? resolved.attempted.map((attempt) => `  Tried: ${attempt}`) : undefined,
        );
      }
    }

    const model = asString(rawEvaluator.model);

    evaluators.push({
      name,
      type: "llm_judge",
      prompt,
      promptPath,
      model,
    });
  }

  return evaluators.length > 0 ? evaluators : undefined;
}

function coerceEvaluator(candidate: JsonValue | undefined, contextId: string): EvaluatorKind | undefined {
  if (typeof candidate !== "string") {
    return undefined;
  }
  if (isEvaluatorKind(candidate)) {
    return candidate;
  }
  logWarning(`Unknown evaluator '${candidate}' in ${contextId}, falling back to default`);
  return undefined;
}

function logWarning(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join("\n");
    console.warn(`${ANSI_YELLOW}Warning: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
  }
}
