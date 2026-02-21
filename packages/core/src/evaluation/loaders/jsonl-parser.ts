import { readFile } from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';
import { parse as parseYaml } from 'yaml';

import type { EvalTest, JsonObject, JsonValue, TestMessage } from '../types.js';
import { isJsonObject, isTestMessage } from '../types.js';
import { loadConfig } from './config-loader.js';
import { coerceEvaluator, parseEvaluators, parseInlineRubrics } from './evaluator-parser.js';
import { buildSearchRoots, fileExists, resolveToAbsolutePath } from './file-resolver.js';
import { processExpectedMessages, processMessages } from './message-processor.js';
import { resolveExpectedMessages, resolveInputMessages } from './shorthand-expansion.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

type LoadOptions = {
  readonly verbose?: boolean;
  /** Filter tests by ID pattern (glob supported, e.g., "summary-*") */
  readonly filter?: string;
};

/**
 * Sidecar metadata structure for JSONL datasets.
 */
type SidecarMetadata = {
  readonly description?: string;
  readonly dataset?: string;
  readonly execution?: JsonObject;
  readonly evaluator?: JsonValue;
};

/**
 * Raw test from JSONL line.
 */
type RawJsonlEvalCase = JsonObject & {
  readonly id?: JsonValue;
  readonly conversation_id?: JsonValue;
  readonly criteria?: JsonValue;
  /** @deprecated Use `criteria` instead */
  readonly expected_outcome?: JsonValue;
  readonly input?: JsonValue;
  readonly expected_output?: JsonValue;
  readonly execution?: JsonValue;
  readonly evaluators?: JsonValue;
  readonly rubrics?: JsonValue;
};

/**
 * Detect file format by extension.
 */
export function detectFormat(filePath: string): 'yaml' | 'jsonl' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jsonl') return 'jsonl';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  throw new Error(`Unsupported file format: '${ext}'. Supported formats: .yaml, .yml, .jsonl`);
}

/**
 * Load sidecar YAML metadata file for a JSONL dataset.
 */
async function loadSidecarMetadata(jsonlPath: string, verbose: boolean): Promise<SidecarMetadata> {
  const dir = path.dirname(jsonlPath);
  const base = path.basename(jsonlPath, '.jsonl');
  const sidecarPath = path.join(dir, `${base}.yaml`);

  if (!(await fileExists(sidecarPath))) {
    if (verbose) {
      logWarning(`Sidecar metadata file not found: ${sidecarPath} (using defaults)`);
    }
    return {};
  }

  try {
    const content = await readFile(sidecarPath, 'utf8');
    const parsed = parseYaml(content) as unknown;

    if (!isJsonObject(parsed)) {
      logWarning(`Invalid sidecar metadata format in ${sidecarPath}`);
      return {};
    }

    return {
      description: asString(parsed.description),
      dataset: asString(parsed.dataset),
      execution: isJsonObject(parsed.execution) ? parsed.execution : undefined,
      evaluator: parsed.evaluator,
    };
  } catch (error) {
    logWarning(`Could not read sidecar metadata from ${sidecarPath}: ${(error as Error).message}`);
    return {};
  }
}

/**
 * Parse JSONL file content into raw eval cases.
 */
function parseJsonlContent(content: string, filePath: string): RawJsonlEvalCase[] {
  const lines = content.split('\n');
  const cases: RawJsonlEvalCase[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue; // Skip empty lines

    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isJsonObject(parsed)) {
        throw new Error('Expected JSON object');
      }
      cases.push(parsed as RawJsonlEvalCase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Line ${i + 1}: Invalid JSON - ${message}\n  File: ${filePath}`);
    }
  }

  return cases;
}

/**
 * Load tests from a JSONL file with optional sidecar YAML metadata.
 */
export async function loadTestsFromJsonl(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<readonly EvalTest[]> {
  const verbose = options?.verbose ?? false;
  const filterPattern = options?.filter;
  const absoluteTestPath = path.resolve(evalFilePath);

  const repoRootPath = resolveToAbsolutePath(repoRoot);
  const searchRoots = buildSearchRoots(absoluteTestPath, repoRootPath);

  // Load configuration (walks up directory tree to repo root)
  const config = await loadConfig(absoluteTestPath, repoRootPath);
  const guidelinePatterns = config?.guideline_patterns;

  // Load sidecar metadata
  const sidecar = await loadSidecarMetadata(absoluteTestPath, verbose);

  // Parse JSONL content
  const rawFile = await readFile(absoluteTestPath, 'utf8');
  const rawCases = parseJsonlContent(rawFile, evalFilePath);

  // Derive dataset name: sidecar > filename
  const fallbackDataset = path.basename(absoluteTestPath, '.jsonl') || 'eval';
  const datasetName =
    sidecar.dataset && sidecar.dataset.trim().length > 0 ? sidecar.dataset : fallbackDataset;

  // Global defaults from sidecar
  const globalEvaluator = coerceEvaluator(sidecar.evaluator, 'sidecar') ?? 'llm_judge';
  const globalExecution = sidecar.execution;

  if (verbose) {
    console.log(`\n[JSONL Dataset: ${evalFilePath}]`);
    console.log(`  Cases: ${rawCases.length}`);
    console.log(`  Dataset name: ${datasetName}`);
    if (sidecar.description) {
      console.log(`  Description: ${sidecar.description}`);
    }
  }

  const results: EvalTest[] = [];

  for (let lineIndex = 0; lineIndex < rawCases.length; lineIndex++) {
    const evalcase = rawCases[lineIndex];
    const lineNumber = lineIndex + 1; // 1-based for user-facing messages
    const id = asString(evalcase.id);

    // Skip eval cases that don't match the filter pattern (glob supported)
    if (filterPattern && (!id || !micromatch.isMatch(id, filterPattern))) {
      continue;
    }

    const conversationId = asString(evalcase.conversation_id);
    let outcome = asString(evalcase.criteria);
    if (!outcome && evalcase.expected_outcome !== undefined) {
      outcome = asString(evalcase.expected_outcome);
      if (outcome) {
        logWarning(
          `Test '${asString(evalcase.id) ?? 'unknown'}': 'expected_outcome' is deprecated. Use 'criteria' instead.`,
        );
      }
    }

    // Resolve input with shorthand support
    const inputMessages = resolveInputMessages(evalcase);
    // Resolve expected_output with shorthand support
    const expectedMessages = resolveExpectedMessages(evalcase) ?? [];

    if (!id || !outcome || !inputMessages || inputMessages.length === 0) {
      logError(
        `Skipping incomplete test at line ${lineNumber}: ${id ?? 'unknown'}. Missing required fields: id, criteria, and/or input`,
      );
      continue;
    }

    // expected_output is optional - for outcome-only evaluation
    const hasExpectedMessages = expectedMessages.length > 0;

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
      messageType: 'input',
      verbose,
    });

    // Process expected_output into segments (only if provided)
    // Preserve full message structure including role and tool_calls for evaluator
    const outputSegments = hasExpectedMessages
      ? await processExpectedMessages({
          messages: expectedMessages,
          searchRoots,
          repoRootPath,
          verbose,
        })
      : [];

    // Build reference_answer:
    // Extract the content from the last message in expected_output (similar to candidate_answer)
    let referenceAnswer = '';
    if (outputSegments.length > 0) {
      // Get the last message
      const lastMessage = outputSegments[outputSegments.length - 1];
      const content = lastMessage.content;
      const toolCalls = lastMessage.tool_calls;

      if (typeof content === 'string') {
        referenceAnswer = content;
      } else if (content !== undefined && content !== null) {
        // Serialize just the content, not the entire message
        referenceAnswer = JSON.stringify(content, null, 2);
      } else if (toolCalls !== undefined && toolCalls !== null) {
        // Message with only tool_calls - serialize just the tool_calls
        referenceAnswer = JSON.stringify(toolCalls, null, 2);
      }
    }
    const question = inputTextParts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ');

    // Merge execution config: per-case overrides sidecar
    const caseExecution = isJsonObject(evalcase.execution) ? evalcase.execution : undefined;
    const mergedExecution = caseExecution ?? globalExecution;

    const evalCaseEvaluatorKind = coerceEvaluator(evalcase.evaluator, id) ?? globalEvaluator;
    let evaluators: Awaited<ReturnType<typeof parseEvaluators>>;
    try {
      evaluators = await parseEvaluators(evalcase, mergedExecution, searchRoots, id ?? 'unknown');
    } catch (error) {
      // Skip entire test if evaluator validation fails
      const message = error instanceof Error ? error.message : String(error);
      logError(`Skipping test '${id}' at line ${lineNumber}: ${message}`);
      continue;
    }

    // Handle inline rubrics field (deprecated: use assert: [{type: rubrics, criteria: [...]}] instead)
    const inlineRubrics = evalcase.rubrics;
    if (inlineRubrics !== undefined && Array.isArray(inlineRubrics)) {
      const rubricEvaluator = parseInlineRubrics(inlineRubrics);
      if (rubricEvaluator) {
        // Prepend rubric evaluator to existing evaluators
        evaluators = evaluators ? [rubricEvaluator, ...evaluators] : [rubricEvaluator];
      }
    }

    // Extract file paths from all input segments (non-guideline files)
    const userFilePaths: string[] = [];
    for (const segment of inputSegments) {
      if (segment.type === 'file' && typeof segment.resolvedPath === 'string') {
        userFilePaths.push(segment.resolvedPath);
      }
    }

    // Combine all file paths (guidelines + regular files)
    const allFilePaths = [
      ...guidelinePaths.map((guidelinePath) => path.resolve(guidelinePath)),
      ...userFilePaths,
    ];

    const testCase: EvalTest = {
      id,
      dataset: datasetName,
      conversation_id: conversationId,
      question: question,
      input: inputMessages,
      input_segments: inputSegments,
      expected_output: outputSegments,
      reference_answer: referenceAnswer,
      guideline_paths: guidelinePaths.map((guidelinePath) => path.resolve(guidelinePath)),
      guideline_patterns: guidelinePatterns,
      file_paths: allFilePaths,
      criteria: outcome,
      evaluator: evalCaseEvaluatorKind,
      evaluators,
    };

    if (verbose) {
      console.log(`\n[Test: ${id}]`);
      if (testCase.guideline_paths.length > 0) {
        console.log(`  Guidelines used: ${testCase.guideline_paths.length}`);
        for (const guidelinePath of testCase.guideline_paths) {
          console.log(`    - ${guidelinePath}`);
        }
      } else {
        console.log('  No guidelines found');
      }
    }

    results.push(testCase);
  }

  return results;
}

/** @deprecated Use `loadTestsFromJsonl` instead */
export const loadEvalCasesFromJsonl = loadTestsFromJsonl;

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

function logError(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join('\n');
    console.error(`${ANSI_RED}Error: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.error(`${ANSI_RED}Error: ${message}${ANSI_RESET}`);
  }
}
