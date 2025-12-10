import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { extractCodeBlocks } from "./formatting/segment-formatter.js";
import { extractTargetFromSuite, loadConfig } from "./loaders/config-loader.js";
import { coerceEvaluator, parseEvaluators } from "./loaders/evaluator-parser.js";
import { buildSearchRoots, resolveToAbsolutePath } from "./loaders/file-resolver.js";
import { processMessages, resolveAssistantContent } from "./loaders/message-processor.js";
import type {
  EvalCase,
  JsonObject,
  JsonValue,
  TestMessage,
} from "./types.js";
import { isJsonObject, isTestMessage } from "./types.js";

// Re-export public APIs from modules
export { buildPromptInputs, type PromptInputs } from "./formatting/prompt-builder.js";
export { extractCodeBlocks } from "./formatting/segment-formatter.js";
export { isGuidelineFile } from "./loaders/config-loader.js";

const ANSI_YELLOW = "\u001b[33m";
const ANSI_RESET = "\u001b[0m";
const SCHEMA_EVAL_V2 = "agentv-eval-v2";

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
  const _globalTarget = asString(globalExecution?.target) ?? asString(suite.target);
  
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
      expected_segments: outputSegments,
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function logWarning(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join("\n");
    console.warn(`${ANSI_YELLOW}Warning: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
  }
}
