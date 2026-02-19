import { readFile } from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';
import { parse } from 'yaml';

import {
  extractTargetFromSuite,
  extractTrialsConfig,
  loadConfig,
} from './loaders/config-loader.js';
import {
  coerceEvaluator,
  parseEvaluators,
  parseInlineRubrics,
} from './loaders/evaluator-parser.js';
import { buildSearchRoots, resolveToAbsolutePath } from './loaders/file-resolver.js';
import { detectFormat, loadEvalCasesFromJsonl } from './loaders/jsonl-parser.js';
import { processExpectedMessages, processMessages } from './loaders/message-processor.js';
import { resolveExpectedMessages, resolveInputMessages } from './loaders/shorthand-expansion.js';
import type {
  EvalCase,
  JsonObject,
  JsonValue,
  TestMessage,
  TrialsConfig,
  WorkspaceConfig,
  WorkspaceScriptConfig,
} from './types.js';
import { isJsonObject, isTestMessage } from './types.js';

// Re-export public APIs from modules
export { buildPromptInputs, type PromptInputs } from './formatting/prompt-builder.js';
export {
  DEFAULT_EVAL_PATTERNS,
  extractTrialsConfig,
  isGuidelineFile,
  loadConfig,
} from './loaders/config-loader.js';
export type { AgentVConfig } from './loaders/config-loader.js';
export { detectFormat } from './loaders/jsonl-parser.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

type LoadOptions = {
  readonly verbose?: boolean;
  /** Filter eval cases by ID pattern (glob supported, e.g., "summary-*") */
  readonly filter?: string;
};

type RawTestSuite = JsonObject & {
  readonly cases?: JsonValue;
  /** @deprecated Use `cases` instead */
  readonly eval_cases?: JsonValue;
  /** @deprecated Use `cases` instead */
  readonly evalcases?: JsonValue;
  readonly target?: JsonValue;
  readonly execution?: JsonValue;
  readonly dataset?: JsonValue;
  readonly workspace?: JsonValue;
};

type RawEvalCase = JsonObject & {
  readonly id?: JsonValue;
  readonly conversation_id?: JsonValue;
  readonly criteria?: JsonValue;
  /** @deprecated Use `criteria` instead */
  readonly expected_outcome?: JsonValue;
  readonly input_messages?: JsonValue;
  readonly expected_messages?: JsonValue;
  // Aliases for input_messages/expected_messages
  readonly input?: JsonValue;
  readonly expected_output?: JsonValue;
  readonly execution?: JsonValue;
  readonly evaluators?: JsonValue;
  readonly rubrics?: JsonValue;
  readonly workspace?: JsonValue;
  readonly metadata?: JsonValue;
};

function resolveEvalCases(suite: RawTestSuite): JsonValue | undefined {
  if (suite.cases !== undefined) return suite.cases;
  if (suite.eval_cases !== undefined) {
    logWarning("'eval_cases' is deprecated. Use 'cases' instead.");
    return suite.eval_cases;
  }
  if (suite.evalcases !== undefined) {
    logWarning("'evalcases' is deprecated. Use 'cases' instead.");
    return suite.evalcases;
  }
  return undefined;
}

/**
 * Read metadata from a test suite file (like target name).
 * This is a convenience function for CLI tools that need metadata without loading all eval cases.
 */
export async function readTestSuiteMetadata(
  testFilePath: string,
): Promise<{ target?: string; trials?: TrialsConfig }> {
  try {
    const absolutePath = path.resolve(testFilePath);
    const content = await readFile(absolutePath, 'utf8');
    const parsed = parse(content) as unknown;

    if (!isJsonObject(parsed)) {
      return {};
    }

    return {
      target: extractTargetFromSuite(parsed),
      trials: extractTrialsConfig(parsed),
    };
  } catch {
    return {};
  }
}

/**
 * Load eval cases from a AgentV specification file (YAML or JSONL).
 * Format is detected by file extension: .yaml/.yml for YAML, .jsonl for JSONL.
 */
export type EvalSuiteResult = {
  readonly cases: readonly EvalCase[];
  readonly trials?: TrialsConfig;
};

/**
 * Load eval cases and suite metadata from a single parse.
 * Prefer this over calling loadEvalCases + readTestSuiteMetadata separately.
 */
export async function loadEvalSuite(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<EvalSuiteResult> {
  const format = detectFormat(evalFilePath);
  if (format === 'jsonl') {
    return { cases: await loadEvalCasesFromJsonl(evalFilePath, repoRoot, options) };
  }
  const { cases, parsed } = await loadEvalCasesFromYaml(evalFilePath, repoRoot, options);
  return { cases, trials: extractTrialsConfig(parsed) };
}

export async function loadEvalCases(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<readonly EvalCase[]> {
  // Detect format and route to appropriate parser
  const format = detectFormat(evalFilePath);
  if (format === 'jsonl') {
    return loadEvalCasesFromJsonl(evalFilePath, repoRoot, options);
  }
  const { cases } = await loadEvalCasesFromYaml(evalFilePath, repoRoot, options);
  return cases;
}

async function loadEvalCasesFromYaml(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<{ cases: readonly EvalCase[]; parsed: JsonObject }> {
  // YAML parsing (existing implementation)
  const verbose = options?.verbose ?? false;
  const filterPattern = options?.filter;
  const absoluteTestPath = path.resolve(evalFilePath);

  const repoRootPath = resolveToAbsolutePath(repoRoot);
  const searchRoots = buildSearchRoots(absoluteTestPath, repoRootPath);

  // Load configuration (walks up directory tree to repo root)
  const config = await loadConfig(absoluteTestPath, repoRootPath);
  const guidelinePatterns = config?.guideline_patterns;

  const rawFile = await readFile(absoluteTestPath, 'utf8');
  const parsed = parse(rawFile) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(`Invalid test file format: ${evalFilePath}`);
  }

  const suite = parsed as RawTestSuite;
  const datasetNameFromSuite = asString(suite.dataset)?.trim();
  const fallbackDataset = path.basename(absoluteTestPath).replace(/\.ya?ml$/i, '') || 'eval';
  const datasetName =
    datasetNameFromSuite && datasetNameFromSuite.length > 0
      ? datasetNameFromSuite
      : fallbackDataset;

  const rawTestcases = resolveEvalCases(suite);
  if (!Array.isArray(rawTestcases)) {
    throw new Error(`Invalid test file format: ${evalFilePath} - missing 'cases' field`);
  }

  const globalEvaluator = coerceEvaluator(suite.evaluator, 'global') ?? 'llm_judge';

  // Parse suite-level workspace config (default for all cases)
  const evalFileDir = path.dirname(absoluteTestPath);
  const suiteWorkspace = parseWorkspaceConfig(suite.workspace, evalFileDir);

  // Extract global target from execution.target (or legacy root-level target)
  const globalExecution = isJsonObject(suite.execution) ? suite.execution : undefined;
  const _globalTarget = asString(globalExecution?.target) ?? asString(suite.target);

  const results: EvalCase[] = [];

  for (const rawEvalcase of rawTestcases) {
    if (!isJsonObject(rawEvalcase)) {
      logWarning('Skipping invalid eval case entry (expected object)');
      continue;
    }

    const evalcase = rawEvalcase as RawEvalCase;
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
          `Eval case '${asString(evalcase.id) ?? 'unknown'}': 'expected_outcome' is deprecated. Use 'criteria' instead.`,
        );
      }
    }

    // Resolve input_messages with alias/shorthand support (canonical takes precedence)
    const inputMessages = resolveInputMessages(evalcase);
    // Resolve expected_messages with alias/shorthand support (canonical takes precedence)
    const expectedMessages = resolveExpectedMessages(evalcase) ?? [];

    if (!id || !outcome || !inputMessages || inputMessages.length === 0) {
      logError(
        `Skipping incomplete eval case: ${id ?? 'unknown'}. Missing required fields: id, criteria, and/or input_messages (or input)`,
      );
      continue;
    }

    // expected_messages is optional - for outcome-only evaluation
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

    // Process expected_messages into segments (only if provided)
    // Preserve full message structure including role and tool_calls for expected_messages evaluator
    const outputSegments = hasExpectedMessages
      ? await processExpectedMessages({
          messages: expectedMessages,
          searchRoots,
          repoRootPath,
          verbose,
        })
      : [];

    // Build reference_answer:
    // Extract the content from the last message in expected_messages (similar to candidate_answer)
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

    const evalCaseEvaluatorKind = coerceEvaluator(evalcase.evaluator, id) ?? globalEvaluator;
    let evaluators: Awaited<ReturnType<typeof parseEvaluators>>;
    try {
      evaluators = await parseEvaluators(evalcase, globalExecution, searchRoots, id ?? 'unknown');
    } catch (error) {
      // Skip entire eval case if evaluator validation fails
      const message = error instanceof Error ? error.message : String(error);
      logError(`Skipping eval case '${id}': ${message}`);
      continue;
    }

    // Handle inline rubrics field (syntactic sugar)
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

    // Parse per-case workspace config and merge with suite-level
    const caseWorkspace = parseWorkspaceConfig(evalcase.workspace, evalFileDir);
    const mergedWorkspace = mergeWorkspaceConfigs(suiteWorkspace, caseWorkspace);

    // Parse per-case metadata
    const metadata = isJsonObject(evalcase.metadata)
      ? (evalcase.metadata as Record<string, unknown>)
      : undefined;

    const testCase: EvalCase = {
      id,
      dataset: datasetName,
      conversation_id: conversationId,
      question: question,
      input_messages: inputMessages,
      input_segments: inputSegments,
      expected_messages: outputSegments,
      reference_answer: referenceAnswer,
      guideline_paths: guidelinePaths.map((guidelinePath) => path.resolve(guidelinePath)),
      guideline_patterns: guidelinePatterns,
      file_paths: allFilePaths,
      criteria: outcome,
      evaluator: evalCaseEvaluatorKind,
      evaluators,
      workspace: mergedWorkspace,
      metadata,
    };

    if (verbose) {
      console.log(`\n[Eval Case: ${id}]`);
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

  return { cases: results, parsed: suite };
}

/**
 * Load a single eval case by exact ID match.
 * Throws if the ID is not found.
 */
export async function loadEvalCaseById(
  evalFilePath: string,
  repoRoot: URL | string,
  evalId: string,
): Promise<EvalCase> {
  const cases = await loadEvalCases(evalFilePath, repoRoot);
  const match = cases.find((c) => c.id === evalId);
  if (!match) {
    const available = cases.map((c) => c.id).join(', ');
    throw new Error(
      `Eval case "${evalId}" not found in ${evalFilePath}. Available IDs: ${available}`,
    );
  }
  return match;
}

/**
 * Parse a WorkspaceScriptConfig from raw YAML value.
 */
function parseWorkspaceScriptConfig(
  raw: unknown,
  evalFileDir: string,
): WorkspaceScriptConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const script = obj.script;
  if (!Array.isArray(script) || script.length === 0) return undefined;
  const scriptArr = script.filter((s): s is string => typeof s === 'string');
  if (scriptArr.length === 0) return undefined;

  const timeoutMs = typeof obj.timeout_ms === 'number' ? obj.timeout_ms : undefined;
  let cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;

  // Resolve relative cwd against eval file directory
  if (cwd && !path.isAbsolute(cwd)) {
    cwd = path.resolve(evalFileDir, cwd);
  }

  const config: WorkspaceScriptConfig = { script: scriptArr };
  if (timeoutMs !== undefined) {
    return { ...config, timeout_ms: timeoutMs, cwd };
  }
  return cwd ? { ...config, cwd } : config;
}

/**
 * Parse a WorkspaceConfig from raw YAML value.
 */
function parseWorkspaceConfig(raw: unknown, evalFileDir: string): WorkspaceConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  let template = typeof obj.template === 'string' ? obj.template : undefined;
  if (template && !path.isAbsolute(template)) {
    template = path.resolve(evalFileDir, template);
  }

  const setupScript = parseWorkspaceScriptConfig(obj.setup_script, evalFileDir);
  const teardownScript = parseWorkspaceScriptConfig(obj.teardown_script, evalFileDir);

  let env: Record<string, string> | undefined;
  if (isJsonObject(obj.env)) {
    env = {};
    for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
      env[k] = String(v);
    }
  }

  if (!template && !setupScript && !teardownScript && !env) return undefined;

  return {
    ...(template !== undefined && { template }),
    ...(setupScript !== undefined && { setup_script: setupScript }),
    ...(teardownScript !== undefined && { teardown_script: teardownScript }),
    ...(env !== undefined && { env }),
  };
}

/**
 * Merge case-level workspace config with suite-level defaults.
 * Strategy: template/scripts replaced, env deep-merged.
 */
function mergeWorkspaceConfigs(
  suiteLevel: WorkspaceConfig | undefined,
  caseLevel: WorkspaceConfig | undefined,
): WorkspaceConfig | undefined {
  if (!suiteLevel && !caseLevel) return undefined;
  if (!suiteLevel) return caseLevel;
  if (!caseLevel) return suiteLevel;

  // Deep merge env (case extends suite)
  const mergedEnv =
    suiteLevel.env || caseLevel.env
      ? { ...(suiteLevel.env ?? {}), ...(caseLevel.env ?? {}) }
      : undefined;

  return {
    // Case replaces suite for template, scripts
    template: caseLevel.template ?? suiteLevel.template,
    setup_script: caseLevel.setup_script ?? suiteLevel.setup_script,
    teardown_script: caseLevel.teardown_script ?? suiteLevel.teardown_script,
    ...(mergedEnv !== undefined && { env: mergedEnv }),
  };
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

function logError(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join('\n');
    console.error(`${ANSI_RED}Error: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.error(`${ANSI_RED}Error: ${message}${ANSI_RESET}`);
  }
}
