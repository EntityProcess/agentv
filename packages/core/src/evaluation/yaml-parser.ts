import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import micromatch from 'micromatch';
import { stringify as stringifyYaml } from 'yaml';

import { normalizeCategoryPath } from './category.js';
import {
  type ExperimentConfig,
  normalizeExperimentConfig,
  normalizeExperimentRunOverride,
} from './experiment.js';
import { collectResolvedInputFilePaths } from './input-message-utils.js';
import { interpolateEnv, interpolateTemplateVars } from './interpolation.js';
import { loadTestsFromAgentSkills } from './loaders/agent-skills-parser.js';
import {
  expandFileReferences,
  loadCasesFromDirectory,
  loadCasesFromFile,
} from './loaders/case-file-loader.js';
import {
  extractBudgetUsd,
  extractCacheConfig,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetRefsFromSuite,
  extractTargetsFromSuite,
  extractThreshold,
  extractWorkersFromSuite,
  loadConfig,
} from './loaders/config-loader.js';
import { buildSearchRoots, resolveToAbsolutePath } from './loaders/file-resolver.js';
import {
  coerceEvaluator,
  collectAssertionTemplateSourceReferences,
  parseGraders,
  parseInlineRubrics,
  parsePreprocessors,
  warnUnconsumedCriteria,
} from './loaders/grader-parser.js';
import { detectFormat, loadTestsFromJsonl } from './loaders/jsonl-parser.js';
import { processExpectedMessages, processMessages } from './loaders/message-processor.js';
import { loadPromptMdFallback } from './loaders/prompt-md-fallback.js';
import {
  expandInputShorthand,
  resolveExpectedMessages,
  resolveInputMessages,
} from './loaders/shorthand-expansion.js';
import { parseMetadata } from './metadata.js';
import type {
  ConversationAggregation,
  ConversationMode,
  ConversationTurn,
  DockerWorkspaceConfig,
  EvalGraderSource,
  EvalRunOverride,
  EvalSourceReference,
  EvalTest,
  EvalTestSource,
  GraderConfig,
  JsonObject,
  JsonValue,
  RepoConfig,
  TestMessage,
  TestMessageContent,
  TurnFailurePolicy,
  WorkspaceConfig,
  WorkspaceEnvConfig,
  WorkspaceHookConfig,
  WorkspaceHooksConfig,
  WorkspaceScriptConfig,
} from './types.js';
import { isJsonObject, isTestMessage } from './types.js';
import { parseRepoConfig } from './workspace/repo-config-parser.js';
import { parseYamlValue } from './yaml-loader.js';

// Re-export public APIs from modules
export { buildPromptInputs, type PromptInputs } from './formatting/prompt-builder.js';
export {
  DEFAULT_EVAL_PATTERNS,
  extractCacheConfig,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetRefsFromSuite,
  extractTargetsFromSuite,
  extractThreshold,
  extractWorkersFromSuite,
  loadConfig,
} from './loaders/config-loader.js';
export type { AgentVConfig, CacheConfig, ExecutionDefaults } from './loaders/config-loader.js';
export { detectFormat } from './loaders/jsonl-parser.js';
export type { EvalMetadata } from './metadata.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

type LoadOptions = {
  readonly verbose?: boolean;
  /** Filter tests by ID pattern(s) (glob supported, e.g., "summary-*"). Arrays use OR logic. */
  readonly filter?: string | readonly string[];
  /** Category derived from the eval file's directory path */
  readonly category?: string;
  /** Internal DFS stack for detecting circular `type: suite` imports. */
  readonly suiteImportStack?: readonly SuiteImportStackEntry[];
};

type SuiteImportStackEntry = {
  readonly identity: string;
  readonly displayPath: string;
};

const KNOWN_TEST_EXECUTION_FIELDS = new Set([
  'workers',
  'assertions',
  'evaluators',
  'skip_defaults',
  'cache',
  'trials',
  'budget_usd',
  'budgetUsd',
  'fail_on_error',
  'failOnError',
  'threshold',
  'workspace',
]);

function matchesFilter(id: string, filter: string | readonly string[]): boolean {
  return typeof filter === 'string'
    ? micromatch.isMatch(id, filter)
    : filter.some((pattern) => micromatch.isMatch(id, pattern));
}

async function canonicalEvalFileIdentity(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  return realpath(absolutePath).catch(() => absolutePath);
}

async function dedupeResolvedPathsByIdentity(
  resolvedPaths: readonly string[],
): Promise<readonly string[]> {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const resolvedPath of resolvedPaths) {
    const identity = await canonicalEvalFileIdentity(resolvedPath);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push(resolvedPath);
  }
  return deduped;
}

function displayEvalImportPath(filePath: string): string {
  const relativePath = path.relative(process.cwd(), filePath);
  return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    ? relativePath
    : filePath;
}

function formatCircularImportChain(
  stack: readonly SuiteImportStackEntry[],
  repeated: SuiteImportStackEntry,
): string {
  const start = stack.findIndex((entry) => entry.identity === repeated.identity);
  const cycle = [...(start >= 0 ? stack.slice(start) : stack), repeated];
  return cycle.map((entry) => entry.displayPath).join(' -> ');
}

type RawTestSuite = JsonObject & {
  readonly imports?: JsonValue;
  readonly tests?: JsonValue;
  /** @deprecated Use `tests` instead */
  readonly eval_cases?: JsonValue;
  /** @deprecated Use `tests` instead */
  readonly evalcases?: JsonValue;
  readonly target?: JsonValue;
  readonly experiment?: JsonValue;
  readonly execution?: JsonValue;
  readonly policy?: JsonValue;
  readonly workspace?: JsonValue;
  readonly assertions?: JsonValue;
  readonly preprocessors?: JsonValue;
  readonly input?: JsonValue;
  readonly metadata?: JsonValue;
  readonly governance?: JsonValue;
  /** Shorthand: list of file paths to prepend as type:file content blocks in each test's user message. */
  readonly input_files?: JsonValue;
  // Suite-level metadata fields
  readonly name?: JsonValue;
  readonly description?: JsonValue;
  readonly category?: string;
  readonly version?: JsonValue;
  readonly author?: JsonValue;
  readonly tags?: JsonValue;
  readonly license?: JsonValue;
  readonly requires?: JsonValue;
};

type RawEvalCase = JsonObject & {
  readonly id?: JsonValue;
  readonly vars?: JsonValue;
  readonly conversation_id?: JsonValue;
  readonly criteria?: JsonValue;
  /** @deprecated Use `criteria` instead */
  readonly expected_outcome?: JsonValue;
  readonly input?: JsonValue;
  /** Shorthand: list of file paths to prepend as type:file content blocks in the user message. */
  readonly input_files?: JsonValue;
  readonly expected_output?: JsonValue;
  readonly evaluator?: JsonValue;
  readonly execution?: JsonValue;
  readonly run?: JsonValue;
  readonly evaluators?: JsonValue;
  readonly assertions?: JsonValue;
  readonly rubrics?: JsonValue;
  readonly workspace?: JsonValue;
  readonly metadata?: JsonValue;
  readonly depends_on?: JsonValue;
  readonly on_dependency_failure?: JsonValue;
  readonly mode?: JsonValue;
  readonly turns?: JsonValue;
  readonly aggregation?: JsonValue;
  readonly on_turn_failure?: JsonValue;
  readonly window_size?: JsonValue;
};

function resolveTests(suite: RawTestSuite): JsonValue | undefined {
  if (suite.tests !== undefined) return suite.tests;
  if (suite.eval_cases !== undefined) {
    logWarning("'eval_cases' is deprecated. Use 'tests' instead.");
    return suite.eval_cases;
  }
  if (suite.evalcases !== undefined) {
    logWarning("'evalcases' is deprecated. Use 'tests' instead.");
    return suite.evalcases;
  }
  return undefined;
}

function interpolateCaseField<T extends JsonValue | undefined>(
  value: T,
  vars: JsonObject | undefined,
): T {
  if (!vars || value === undefined) {
    return value;
  }
  return interpolateTemplateVars(value, vars as Record<string, unknown>) as T;
}

function interpolateCaseTurns(
  turns: JsonValue | undefined,
  vars: JsonObject | undefined,
): JsonValue | undefined {
  if (!vars || !Array.isArray(turns)) {
    return turns;
  }

  return turns.map((rawTurn) => {
    if (!isJsonObject(rawTurn)) {
      return rawTurn;
    }

    return {
      ...rawTurn,
      input: interpolateCaseField(rawTurn.input, vars),
      expected_output: interpolateCaseField(rawTurn.expected_output, vars),
    } satisfies JsonObject;
  });
}

function interpolateRawEvalCase(raw: RawEvalCase, vars: JsonObject | undefined): RawEvalCase {
  if (!vars) {
    return raw;
  }

  return {
    ...raw,
    ...(raw.criteria !== undefined ? { criteria: interpolateCaseField(raw.criteria, vars) } : {}),
    ...(raw.expected_outcome !== undefined
      ? { expected_outcome: interpolateCaseField(raw.expected_outcome, vars) }
      : {}),
    ...(raw.input !== undefined ? { input: interpolateCaseField(raw.input, vars) } : {}),
    ...(raw.input_files !== undefined
      ? { input_files: interpolateCaseField(raw.input_files, vars) }
      : {}),
    ...(raw.expected_output !== undefined
      ? { expected_output: interpolateCaseField(raw.expected_output, vars) }
      : {}),
    ...(raw.turns !== undefined ? { turns: interpolateCaseTurns(raw.turns, vars) } : {}),
  };
}

/**
 * Read metadata from a test suite file (like target name).
 * This is a convenience function for CLI tools that need metadata without loading all tests.
 */
export async function readTestSuiteMetadata(testFilePath: string): Promise<{
  target?: string;
  targets?: readonly string[];
  targetRefs?: readonly import('./types.js').EvalTargetRef[];
}> {
  try {
    const absolutePath = path.resolve(testFilePath);
    const content = await readFile(absolutePath, 'utf8');
    const parsed = interpolateEnv(parseYamlValue(content), process.env) as unknown;

    if (!isJsonObject(parsed)) {
      return {};
    }

    return {
      target: extractTargetFromSuite(parsed),
      targets: extractTargetsFromSuite(parsed),
      targetRefs: extractTargetRefsFromSuite(parsed),
    };
  } catch {
    return {};
  }
}

/**
 * Load tests from an AgentV specification file (YAML or JSONL).
 * Format is detected by file extension: .yaml/.yml for YAML, .jsonl for JSONL.
 */
export type EvalSuiteResult = {
  readonly tests: readonly EvalTest[];
  /** Suite-level targets from execution.targets (matrix evaluation) */
  readonly targets?: readonly string[];
  /** Suite-level target refs with hooks from execution.targets (object form) */
  readonly targetRefs?: readonly import('./types.js').EvalTargetRef[];
  /** Suite-level workers from execution.workers */
  readonly workers?: number;
  /** Suite-level cache config from execution.cache */
  readonly cacheConfig?: import('./loaders/config-loader.js').CacheConfig;
  /** Suite-level metadata (name, description, version, etc.) */
  readonly metadata?: import('./metadata.js').EvalMetadata;
  /** Suite-level total cost budget in USD */
  readonly budgetUsd?: number;
  /** Execution error tolerance: true or false */
  readonly failOnError?: import('./types.js').FailOnError;
  /** Suite-level quality threshold (0-1) — suite fails if mean score is below */
  readonly threshold?: number;
  /** Top-level runtime block from `experiment:` or legacy `execution:`. */
  readonly experimentConfig?: ExperimentConfig;
  /** Inline target definition from a TS eval config. */
  readonly inlineTarget?: import('./providers/types.js').TargetDefinition;
  /** Custom provider factory from a TS eval config task(). */
  readonly providerFactory?: import('./providers/provider-registry.js').ProviderFactoryFn;
};

/**
 * Load tests and suite metadata from a single parse.
 * Prefer this over calling loadTests + readTestSuiteMetadata separately.
 */
export async function loadTestSuite(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<EvalSuiteResult> {
  const format = detectFormat(evalFilePath);
  if (format === 'jsonl') {
    return { tests: await loadTestsFromJsonl(evalFilePath, repoRoot, options) };
  }
  if (format === 'agent-skills-json') {
    return { tests: await loadTestsFromAgentSkills(evalFilePath) };
  }
  if (format === 'typescript') {
    const { loadTsEvalSuite } = await import('./loaders/ts-eval-loader.js');
    return loadTsEvalSuite(evalFilePath, resolveToAbsolutePath(repoRoot), options);
  }
  const { tests, parsed } = await loadTestsFromYaml(evalFilePath, repoRoot, options);
  return buildEvalSuiteResult(parsed, tests);
}

/** @deprecated Use `loadTestSuite` instead */
export const loadEvalSuite = loadTestSuite;

export async function loadTestSuiteFromYamlObject(
  evalFilePath: string,
  suiteObject: unknown,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<EvalSuiteResult> {
  const { tests, parsed } = await loadTestsFromParsedYamlValue(
    suiteObject,
    evalFilePath,
    repoRoot,
    options,
  );

  return buildEvalSuiteResult(parsed, tests);
}

export async function loadTests(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<readonly EvalTest[]> {
  // Detect format and route to appropriate parser
  const format = detectFormat(evalFilePath);
  if (format === 'jsonl') {
    return loadTestsFromJsonl(evalFilePath, repoRoot, options);
  }
  if (format === 'agent-skills-json') {
    return loadTestsFromAgentSkills(evalFilePath);
  }
  if (format === 'typescript') {
    const { loadTsEvalSuite } = await import('./loaders/ts-eval-loader.js');
    const suite = await loadTsEvalSuite(evalFilePath, resolveToAbsolutePath(repoRoot), options);
    return suite.tests;
  }
  const { tests } = await loadTestsFromYaml(evalFilePath, repoRoot, options);
  return tests;
}

/** @deprecated Use `loadTests` instead */
export const loadEvalCases = loadTests;

async function loadTestsFromYaml(
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<{ tests: readonly EvalTest[]; parsed: JsonObject }> {
  const absoluteTestPath = path.resolve(evalFilePath);
  const currentImport: SuiteImportStackEntry = {
    identity: await canonicalEvalFileIdentity(absoluteTestPath),
    displayPath: displayEvalImportPath(absoluteTestPath),
  };
  const importStack = options?.suiteImportStack ?? [];
  if (importStack.some((entry) => entry.identity === currentImport.identity)) {
    throw new Error(
      `Circular eval suite import: ${formatCircularImportChain(importStack, currentImport)}`,
    );
  }
  const rawFile = await readFile(absoluteTestPath, 'utf8');

  return loadTestsFromParsedYamlValue(parseYamlValue(rawFile), evalFilePath, repoRoot, {
    ...options,
    suiteImportStack: [...importStack, currentImport],
  });
}

async function loadTestsFromParsedYamlValue(
  rawParsed: unknown,
  evalFilePath: string,
  repoRoot: URL | string,
  options?: LoadOptions,
): Promise<{ tests: readonly EvalTest[]; parsed: JsonObject }> {
  const verbose = options?.verbose ?? false;
  const filterPattern = options?.filter;
  const absoluteTestPath = path.resolve(evalFilePath);

  const repoRootPath = resolveToAbsolutePath(repoRoot);
  const searchRoots = buildSearchRoots(absoluteTestPath, repoRootPath);

  // Load configuration (walks up directory tree to repo root)
  const config = await loadConfig(absoluteTestPath, repoRootPath);

  const rawCaseSnapshots = buildRawInlineTestSnapshots(rawParsed);
  const interpolated = interpolateEnv(rawParsed, process.env) as unknown;
  if (!isJsonObject(interpolated)) {
    throw new Error(`Invalid test file format: ${evalFilePath}`);
  }

  const suite = interpolated as RawTestSuite;
  const suiteNameFromFile = asString(suite.name)?.trim();
  const fallbackSuiteName =
    path
      .basename(absoluteTestPath)
      .replace(/\.eval\.ya?ml$/i, '')
      .replace(/\.ya?ml$/i, '') || 'eval';
  const suiteName =
    suiteNameFromFile && suiteNameFromFile.length > 0 ? suiteNameFromFile : fallbackSuiteName;

  const rawTestCases = resolveTests(suite);
  const suiteExperimentConfig = normalizeSuiteExperimentConfig(suite);
  // Top-level `metadata:` is inherited by cases. Suite identity tags are parsed
  // separately by parseMetadata() and are not case tags.
  const suiteMetadataPayload = extractSuiteMetadataPayload(suite);

  const globalEvaluator = coerceEvaluator(suite.evaluator, 'global') ?? 'llm-grader';
  const suitePreprocessors = await parsePreprocessors(
    suite.preprocessors,
    searchRoots,
    '<suite>',
    absoluteTestPath,
  );

  const importedSuiteTests: EvalTest[] = [];
  const evalFileDir = path.dirname(absoluteTestPath);
  const parentWorkspace = parentWorkspaceLocation(suite);
  const importEntries = readImports(suite.imports);
  const expandedImports = await expandImportEntries({
    entries: importEntries,
    evalFileDir,
    repoRoot,
    suiteMetadataPayload,
    parentWorkspaceLocation: parentWorkspace,
    options,
  });
  importedSuiteTests.push(...expandedImports.importedSuiteTests);

  // Resolve tests: string path to external file/directory, inline array, legacy include entries, or error.
  let expandedTestCases: readonly JsonValue[];
  if (typeof rawTestCases === 'string') {
    expandedTestCases = [
      ...expandedImports.rawCases,
      ...(await loadRawCasesFromShorthand(rawTestCases, evalFileDir)),
    ];
  } else if (Array.isArray(rawTestCases)) {
    const expanded = await expandInlineTestEntries({
      entries: rawTestCases,
      evalFileDir,
      repoRoot,
      suiteMetadataPayload,
      parentWorkspaceLocation: parentWorkspace,
      options,
    });
    expandedTestCases = [...expandedImports.rawCases, ...expanded.rawCases];
    importedSuiteTests.push(...expanded.importedSuiteTests);
  } else if (rawTestCases === undefined && importEntries.length > 0) {
    expandedTestCases = expandedImports.rawCases;
  } else {
    throw new Error(`Invalid test file format: ${evalFilePath} - missing 'tests' field`);
  }

  const suiteWorkspace = await resolveWorkspaceConfig(suite.workspace, evalFileDir);

  const rawSuiteInput = suite.input;
  const rawSuiteInputFiles = suite.input_files;

  // Extract global target from top-level target or legacy execution.target.
  const rawGlobalExecution = readSuiteRuntimeBlock(suite, evalFilePath);
  const _globalTarget = asString(suite.target) ?? asString(rawGlobalExecution?.target);

  // Build global execution context, including suite-level assertions (which is a sibling of execution)
  const suiteAssertions = suite.assertions;
  const globalExecution: JsonObject | undefined =
    suiteAssertions !== undefined
      ? { ...(rawGlobalExecution ?? {}), assertions: suiteAssertions }
      : rawGlobalExecution;

  const results: EvalTest[] = [];

  for (const rawTestCase of expandedTestCases) {
    if (!isJsonObject(rawTestCase)) {
      logWarning('Skipping invalid test entry (expected object)');
      continue;
    }

    const testCaseConfig = rawTestCase as RawEvalCase;
    const id = asString(testCaseConfig.id);

    // Skip tests that don't match the filter pattern (glob supported)
    if (filterPattern && (!id || !matchesFilter(id, filterPattern))) {
      continue;
    }

    const caseVars = isJsonObject(testCaseConfig.vars) ? testCaseConfig.vars : undefined;
    const renderedCase = interpolateRawEvalCase(testCaseConfig, caseVars);

    const conversationId = asString(renderedCase.conversation_id);
    let outcome = asString(renderedCase.criteria);
    if (!outcome && renderedCase.expected_outcome !== undefined) {
      outcome = asString(renderedCase.expected_outcome);
      if (outcome) {
        logWarning(
          `Test '${asString(renderedCase.id) ?? 'unknown'}': 'expected_outcome' is deprecated. Use 'criteria' instead.`,
        );
      }
    }

    // Extract per-case execution config early (reused below for skip_defaults)
    const caseExecution = isJsonObject(renderedCase.execution) ? renderedCase.execution : undefined;
    rejectUnsupportedTestExecutionFields(caseExecution, id);
    if (caseExecution?.workspace !== undefined) {
      throw new Error(
        `test '${id ?? 'unknown'}'.execution.workspace has been removed from eval YAML. Put machine-local workspace_path/workspace_mode in .agentv/config.local.yaml under execution, or pass --workspace-path/--workspace-mode. Keep portable task setup in test workspace or suite workspace.`,
      );
    }
    const skipDefaults = caseExecution?.skip_defaults === true;
    const caseThreshold =
      typeof caseExecution?.threshold === 'number' &&
      (caseExecution.threshold as number) >= 0 &&
      (caseExecution.threshold as number) <= 1
        ? (caseExecution.threshold as number)
        : undefined;
    const caseRun = mergeRunOverrides(
      caseThreshold !== undefined ? { threshold: caseThreshold } : undefined,
      normalizeRunOverride(renderedCase.run, `test '${id ?? 'unknown'}'.run`),
    );

    // Resolve input with shorthand support (pass suite-level input_files for merge)
    const effectiveSuiteInputFiles =
      rawSuiteInputFiles && !skipDefaults
        ? interpolateCaseField(rawSuiteInputFiles, caseVars)
        : undefined;
    let inputCase = renderedCase;
    let inputSuiteFiles = effectiveSuiteInputFiles;
    if (renderedCase.input === undefined) {
      const promptFallback = await loadPromptMdFallback({
        evalFilePath: absoluteTestPath,
        searchRoots,
        testInputFiles: renderedCase.input_files,
        suiteInputFiles: effectiveSuiteInputFiles,
      });
      if (promptFallback) {
        if (promptFallback.inputFilesSource === 'test') {
          const { input_files: _inputFiles, ...caseWithoutInputFiles } = renderedCase;
          inputCase = {
            ...caseWithoutInputFiles,
            input: promptFallback.promptText,
            ...(promptFallback.remainingInputFiles
              ? { input_files: [...promptFallback.remainingInputFiles] }
              : {}),
          };
          inputSuiteFiles = undefined;
        } else {
          inputCase = {
            ...renderedCase,
            input: promptFallback.promptText,
          };
          if (promptFallback.inputFilesSource === 'suite') {
            inputSuiteFiles = promptFallback.remainingInputFiles
              ? [...promptFallback.remainingInputFiles]
              : undefined;
          }
        }
      }
    }
    const testInputMessages = resolveInputMessages(inputCase, inputSuiteFiles);
    // Resolve expected_output with shorthand support
    const expectedMessages = resolveExpectedMessages(renderedCase) ?? [];

    // A test is complete when it has id, input, and at least one of: criteria, expected_output, assertions, or turns (conversation mode)
    const hasEvaluationSpec =
      !!outcome ||
      expectedMessages.length > 0 ||
      renderedCase.assertions !== undefined ||
      (Array.isArray(renderedCase.turns) && renderedCase.turns.length > 0);
    if (!id || !hasEvaluationSpec || !testInputMessages || testInputMessages.length === 0) {
      logError(
        `Skipping incomplete test: ${id ?? 'unknown'}. Missing required fields: id, input or PROMPT.md, and at least one of criteria/expected_output/assertions/turns`,
      );
      continue;
    }

    // Prepend suite-level input to test input (respecting skip_defaults)
    const effectiveSuiteInputValue =
      rawSuiteInput && !skipDefaults ? interpolateCaseField(rawSuiteInput, caseVars) : undefined;
    const effectiveSuiteInputMessages = expandInputShorthand(effectiveSuiteInputValue);

    // expected_output is optional - for outcome-only evaluation
    const hasExpectedMessages = expectedMessages.length > 0;

    const inputTextParts: string[] = [];

    // Process suite-level input first
    const suiteResolvedInputMessages = effectiveSuiteInputMessages
      ? await processMessages({
          messages: effectiveSuiteInputMessages,
          searchRoots,
          repoRootPath,
          textParts: inputTextParts,
          messageType: 'input',
          verbose,
        })
      : [];

    // Process test-level input
    const testResolvedInputMessages = await processMessages({
      messages: testInputMessages,
      searchRoots,
      repoRootPath,
      textParts: inputTextParts,
      messageType: 'input',
      verbose,
    });
    const inputMessages = [...suiteResolvedInputMessages, ...testResolvedInputMessages];

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
    // Extract the content from the last message in expected_output (similar to answer)
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

    const testCaseEvaluatorKind = coerceEvaluator(renderedCase.evaluator, id) ?? globalEvaluator;
    let evaluators: Awaited<ReturnType<typeof parseGraders>>;
    try {
      evaluators = await parseGraders(
        renderedCase,
        globalExecution,
        searchRoots,
        id ?? 'unknown',
        suitePreprocessors,
      );
    } catch (error) {
      // Skip entire test if evaluator validation fails
      const message = error instanceof Error ? error.message : String(error);
      logError(`Skipping test '${id}': ${message}`);
      continue;
    }

    const assertionTemplateReferences = await collectAssertionTemplateSourceReferences(
      renderedCase,
      globalExecution,
      searchRoots,
      id ?? 'unknown',
    );

    // Handle inline rubrics field (deprecated: use assertions: [{type: rubrics, criteria: [...]}] instead)
    const inlineRubrics = renderedCase.rubrics;
    if (inlineRubrics !== undefined && Array.isArray(inlineRubrics)) {
      const rubricEvaluator = parseInlineRubrics(inlineRubrics);
      if (rubricEvaluator) {
        // Prepend rubric evaluator to existing evaluators
        evaluators = evaluators ? [rubricEvaluator, ...evaluators] : [rubricEvaluator];
      }
    }

    warnUnconsumedCriteria(outcome, evaluators, id ?? 'unknown');

    const userFilePaths = collectResolvedInputFilePaths(inputMessages);

    // Parse per-case workspace config and merge with suite-level
    const caseWorkspace = await resolveWorkspaceConfig(renderedCase.workspace, evalFileDir);
    const mergedWorkspace = mergeWorkspaceConfigs(suiteWorkspace, caseWorkspace);

    // Parse per-case metadata, then merge suite-level metadata payload.
    // Arrays concatenate (suite-first, deduplicated), scalars on the case win.
    const rawCaseMetadata = isJsonObject(renderedCase.metadata)
      ? (renderedCase.metadata as Record<string, unknown>)
      : undefined;
    const metadata = mergeSuiteMetadataPayload(rawCaseMetadata, suiteMetadataPayload);

    // Extract dependency fields
    const dependsOn = Array.isArray(renderedCase.depends_on)
      ? (renderedCase.depends_on as readonly string[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : undefined;
    const onDependencyFailureRaw = asString(renderedCase.on_dependency_failure);
    const onDependencyFailure =
      onDependencyFailureRaw === 'skip' ||
      onDependencyFailureRaw === 'fail' ||
      onDependencyFailureRaw === 'run'
        ? (onDependencyFailureRaw as import('./types.js').DependencyFailurePolicy)
        : undefined;

    // Extract conversation mode fields
    const modeRaw = asString(renderedCase.mode);
    const mode: ConversationMode | undefined =
      modeRaw === 'conversation' ? 'conversation' : undefined;
    const turns = Array.isArray(renderedCase.turns)
      ? parseTurns(renderedCase.turns as readonly unknown[])
      : undefined;
    const aggregationRaw = asString(renderedCase.aggregation);
    const aggregation: ConversationAggregation | undefined =
      aggregationRaw === 'mean' || aggregationRaw === 'min' || aggregationRaw === 'max'
        ? aggregationRaw
        : undefined;
    const onTurnFailureRaw = asString(renderedCase.on_turn_failure);
    const onTurnFailure: TurnFailurePolicy | undefined =
      onTurnFailureRaw === 'continue' || onTurnFailureRaw === 'stop' ? onTurnFailureRaw : undefined;
    const windowSize =
      typeof renderedCase.window_size === 'number' && renderedCase.window_size >= 1
        ? (renderedCase.window_size as number)
        : undefined;

    const category = normalizeCategoryPath(suite.category ?? options?.category);

    const testCase: EvalTest = {
      id,
      suite: suiteName,
      category,
      conversation_id: conversationId,
      question: question,
      input: inputMessages,
      expected_output: outputSegments,
      reference_answer: referenceAnswer,
      file_paths: userFilePaths,
      criteria: outcome ?? '',
      evaluator: testCaseEvaluatorKind,
      assertions: evaluators,
      ...(suitePreprocessors ? { preprocessors: suitePreprocessors } : {}),
      workspace: mergedWorkspace,
      metadata,
      ...(caseRun?.threshold !== undefined ? { threshold: caseRun.threshold } : {}),
      ...(caseRun !== undefined ? { run: caseRun } : {}),
      ...(mode ? { mode } : {}),
      ...(turns && turns.length > 0 ? { turns } : {}),
      ...(aggregation ? { aggregation } : {}),
      ...(onTurnFailure ? { on_turn_failure: onTurnFailure } : {}),
      ...(windowSize !== undefined ? { window_size: windowSize } : {}),
      ...(dependsOn && dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
      ...(onDependencyFailure ? { on_dependency_failure: onDependencyFailure } : {}),
      source: buildEvalTestSource({
        evalFilePath,
        absoluteTestPath,
        repoRootPath,
        id,
        renderedCase,
        rawCaseSnapshots,
        inputMessages,
        evaluators,
        assertionTemplateReferences,
      }),
    };

    results.push(testCase);
  }

  return {
    tests: [...importedSuiteTests, ...results],
    parsed: suite,
  };
}

function buildEvalSuiteResult(parsed: JsonObject, tests: readonly EvalTest[]): EvalSuiteResult {
  const metadata = parseMetadata(parsed);
  const failOnError = extractFailOnError(parsed);
  const threshold = extractThreshold(parsed);
  const experimentConfig = normalizeSuiteExperimentConfig(parsed);

  return {
    tests,
    targets: extractTargetsFromSuite(parsed),
    targetRefs: extractTargetRefsFromSuite(parsed),
    workers: extractWorkersFromSuite(parsed),
    cacheConfig: extractCacheConfig(parsed),
    budgetUsd: extractBudgetUsd(parsed),
    ...(metadata !== undefined && { metadata }),
    ...(failOnError !== undefined && { failOnError }),
    ...(threshold !== undefined && { threshold }),
    ...(experimentConfig !== undefined && { experimentConfig }),
  };
}

type IncludeEntryType = 'suite' | 'tests';

type ExpandedInlineTestEntries = {
  readonly rawCases: readonly JsonValue[];
  readonly importedSuiteTests: readonly EvalTest[];
};

type NormalizedImportEntry = {
  readonly path: string;
  readonly mode: IncludeEntryType;
  readonly select?: IncludeSelect;
  readonly run?: EvalRunOverride;
  readonly location: string;
  readonly legacy?: boolean;
};

type IncludeSelect = {
  readonly testIds?: string | readonly string[];
  readonly tags?: string | readonly string[];
  readonly metadata?: Record<string, unknown>;
};

function rejectUnsupportedTestExecutionFields(
  caseExecution: JsonObject | undefined,
  testId: string | undefined,
): void {
  if (!caseExecution) return;
  for (const key of Object.keys(caseExecution)) {
    if (!KNOWN_TEST_EXECUTION_FIELDS.has(key)) {
      throw new Error(`test '${testId ?? 'unknown'}'.execution.${key} is not supported.`);
    }
  }
}

function normalizeRunOverride(value: unknown, label: string): EvalRunOverride | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return normalizeExperimentRunOverride(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${reason}`);
  }
}

function mergeRunOverrides(
  base: EvalRunOverride | undefined,
  override: EvalRunOverride | undefined,
): EvalRunOverride | undefined {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }
  return {
    ...base,
    ...override,
  };
}

function applyRunOverrideToImportedTest(
  test: EvalTest,
  includeRun: EvalRunOverride | undefined,
): EvalTest {
  const run = mergeRunOverrides(includeRun, test.run);
  if (!run) {
    return test;
  }
  return {
    ...test,
    run,
  };
}

function markSuiteImportedTest(test: EvalTest): EvalTest {
  return {
    ...test,
    source: {
      ...(test.source ?? {
        evalFilePath: '',
        evalFileAbsolutePath: '',
        testId: test.id,
        testSnapshotYaml: '',
        graderDefinitions: [],
        references: [],
      }),
      importedSuiteName: test.suite ?? 'default',
    },
  };
}

function applyRunOverrideToRawCase(
  testCase: JsonObject,
  includeRun: EvalRunOverride | undefined,
): JsonObject {
  if (!includeRun) {
    return testCase;
  }
  const caseRun = normalizeRunOverride(
    testCase.run,
    `test '${String(testCase.id ?? 'unknown')}'.run`,
  );
  const run = mergeRunOverrides(includeRun, caseRun);
  return run ? { ...testCase, run: run as unknown as JsonObject } : testCase;
}

function isIncludeEntry(value: JsonValue): value is JsonObject & { include: string } {
  return (
    isJsonObject(value) && typeof value.include === 'string' && value.include.trim().length > 0
  );
}

function importEntryPath(value: JsonValue): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (!isJsonObject(value)) {
    return undefined;
  }
  const pathValue = value.path ?? value.include;
  return typeof pathValue === 'string' && pathValue.trim().length > 0
    ? pathValue.trim()
    : undefined;
}

function hasGlobMagic(value: string): boolean {
  return /[*?[\]{}()!+@]/.test(value);
}

function normalizeIncludeEntryType(value: unknown, includePath: string): IncludeEntryType {
  if (value === 'suite' || value === 'tests') {
    return value;
  }
  if (value === undefined) {
    throw new Error(`Missing tests[].type for include '${includePath}'. Use 'suite' or 'tests'.`);
  }
  throw new Error(`Invalid tests[].type for include '${includePath}'. Use 'suite' or 'tests'.`);
}

function readStringPatterns(value: unknown, label: string): string | readonly string[] | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const patterns = value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
    if (patterns.length > 0) {
      return patterns.map((item) => item.trim());
    }
  }
  if (value !== undefined) {
    throw new Error(`Invalid ${label}. Use a glob string or a non-empty array of glob strings.`);
  }
  return undefined;
}

function readSelectPatterns(value: unknown, label: string): IncludeSelect | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return { testIds: readStringPatterns(value, label) };
  }
  if (!isJsonObject(value)) {
    throw new Error(`Invalid ${label}. Use a selector object, glob string, or glob string array.`);
  }
  const testIds = readStringPatterns(value.test_ids ?? value.testIds, `${label}.test_ids`);
  const tags = readStringPatterns(value.tags, `${label}.tags`);
  const metadata = value.metadata;
  if (metadata !== undefined && !isJsonObject(metadata)) {
    throw new Error(`Invalid ${label}.metadata. Use an object of metadata key/value filters.`);
  }
  return {
    ...(testIds !== undefined && { testIds }),
    ...(tags !== undefined && { tags }),
    ...(isJsonObject(metadata) && { metadata: metadata as Record<string, unknown> }),
  };
}

function matchesAnyPattern(value: string, patterns: string | readonly string[]): boolean {
  return typeof patterns === 'string'
    ? micromatch.isMatch(value, patterns)
    : patterns.some((pattern) => micromatch.isMatch(value, pattern));
}

function metadataValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((entry) => metadataValueMatches(actual, entry));
  }
  if (Array.isArray(actual)) {
    return actual.some((entry) => metadataValueMatches(entry, expected));
  }
  return actual === expected;
}

function metadataMatches(
  metadata: Record<string, unknown> | undefined,
  selector: Record<string, unknown> | undefined,
): boolean {
  if (!selector || Object.keys(selector).length === 0) {
    return true;
  }
  if (!metadata) {
    return false;
  }
  return Object.entries(selector).every(([key, expected]) =>
    metadataValueMatches(metadata[key], expected),
  );
}

function tagsMatch(
  metadata: Record<string, unknown> | undefined,
  tags: string | readonly string[] | undefined,
): boolean {
  if (!tags) {
    return true;
  }
  const rawTags = metadata?.tags;
  const actualTags =
    typeof rawTags === 'string'
      ? [rawTags]
      : Array.isArray(rawTags)
        ? rawTags.filter((tag): tag is string => typeof tag === 'string')
        : [];
  return actualTags.some((tag) => matchesAnyPattern(tag, tags));
}

function evalTestMatchesSelect(test: EvalTest, select: IncludeSelect | undefined): boolean {
  if (!select) {
    return true;
  }
  const metadata = isJsonObject(test.metadata)
    ? (test.metadata as Record<string, unknown>)
    : undefined;
  return (
    (select.testIds ? matchesAnyPattern(test.id, select.testIds) : true) &&
    tagsMatch(metadata, select.tags) &&
    metadataMatches(metadata, select.metadata)
  );
}

function rawCaseEffectiveMetadata(
  raw: JsonObject,
  suiteMetadataPayload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const metadata = isJsonObject(raw.metadata)
    ? ({ ...(raw.metadata as Record<string, unknown>) } as Record<string, unknown>)
    : undefined;
  return mergeSuiteMetadataPayload(metadata, suiteMetadataPayload);
}

function rawCaseMatchesSelect(
  testCase: JsonObject,
  select: IncludeSelect | undefined,
  suiteMetadataPayload: Record<string, unknown> | undefined,
): boolean {
  if (!select) {
    return true;
  }
  const id = typeof testCase.id === 'string' ? testCase.id : undefined;
  const metadata = rawCaseEffectiveMetadata(testCase, suiteMetadataPayload);
  return (
    (select.testIds ? (id ? matchesAnyPattern(id, select.testIds) : false) : true) &&
    tagsMatch(metadata, select.tags) &&
    metadataMatches(metadata, select.metadata)
  );
}

function readImports(rawImports: JsonValue | undefined): readonly NormalizedImportEntry[] {
  if (rawImports === undefined) {
    return [];
  }
  if (!isJsonObject(rawImports)) {
    throw new Error("Invalid 'imports' field. Use imports.suites and/or imports.tests.");
  }
  const entries: NormalizedImportEntry[] = [];
  entries.push(...readImportGroup(rawImports.suites, 'suite', 'imports.suites'));
  entries.push(...readImportGroup(rawImports.tests, 'tests', 'imports.tests'));
  return entries;
}

function readImportGroup(
  rawGroup: JsonValue | undefined,
  mode: IncludeEntryType,
  location: string,
): readonly NormalizedImportEntry[] {
  if (rawGroup === undefined) {
    return [];
  }
  const values = Array.isArray(rawGroup) ? rawGroup : [rawGroup];
  return values.map((entry, index) => normalizeImportEntry(entry, mode, `${location}[${index}]`));
}

function normalizeImportEntry(
  entry: JsonValue,
  mode: IncludeEntryType,
  location: string,
): NormalizedImportEntry {
  const includePath = importEntryPath(entry);
  if (!includePath) {
    throw new Error(`Invalid ${location}. Use a path string or an object with a non-empty path.`);
  }
  const select = isJsonObject(entry)
    ? readSelectPatterns(entry.select, `${location}.select for path '${includePath}'`)
    : undefined;
  const includeRun = isJsonObject(entry)
    ? normalizeRunOverride(entry.run, `${location}.run for path '${includePath}'`)
    : undefined;
  return {
    path: includePath,
    mode,
    ...(select !== undefined && { select }),
    ...(includeRun !== undefined && { run: includeRun }),
    location,
  };
}

function normalizeLegacyIncludeEntry(
  entry: JsonObject & { include: string },
): NormalizedImportEntry {
  const includePath = entry.include.trim();
  const mode = normalizeIncludeEntryType(entry.type, includePath);
  const select = readSelectPatterns(entry.select, `tests[].select for include '${includePath}'`);
  const includeRun = normalizeRunOverride(entry.run, `tests[].run for include '${includePath}'`);
  logWarning(
    `tests[].include is deprecated. Use imports.${mode === 'suite' ? 'suites' : 'tests'} with path: ${includePath}`,
  );
  return {
    path: includePath,
    mode,
    ...(select !== undefined && { select }),
    ...(includeRun !== undefined && { run: includeRun }),
    location: 'tests[].include',
    legacy: true,
  };
}

async function expandImportEntries(params: {
  readonly entries: readonly NormalizedImportEntry[];
  readonly evalFileDir: string;
  readonly repoRoot: URL | string;
  readonly suiteMetadataPayload?: Record<string, unknown>;
  readonly parentWorkspaceLocation?: string;
  readonly options?: LoadOptions;
}): Promise<ExpandedInlineTestEntries> {
  const rawCases: JsonValue[] = [];
  const importedSuiteTests: EvalTest[] = [];

  for (const entry of params.entries) {
    const resolvedPaths = await resolveIncludePaths(entry.path, params.evalFileDir);

    for (const resolvedPath of resolvedPaths) {
      if (entry.mode === 'suite') {
        if (params.parentWorkspaceLocation) {
          throw new Error(
            `Parent workspace is not allowed when importing eval suites (${params.parentWorkspaceLocation}): ${entry.path}. Move workspace into the child suite, or import raw cases with imports.tests when you intentionally want parent workspace context.`,
          );
        }
        const suite = await loadTestSuite(resolvedPath, params.repoRoot, {
          ...params.options,
          filter: entry.select?.testIds,
        });
        const selectedTests = params.options?.filter
          ? suite.tests.filter((test) => matchesFilter(test.id, params.options?.filter ?? ''))
          : suite.tests;
        importedSuiteTests.push(
          ...selectedTests
            .filter((test) => evalTestMatchesSelect(test, entry.select))
            .map(markSuiteImportedTest)
            .map((test) => applyRunOverrideToImportedTest(test, entry.run)),
        );
      } else {
        const importedCases = await loadRawCasesForInclude(resolvedPath);
        const filteredCases = entry.select
          ? importedCases.filter((testCase) =>
              rawCaseMatchesSelect(testCase, entry.select, params.suiteMetadataPayload),
            )
          : importedCases;
        rawCases.push(
          ...filteredCases.map((testCase) => applyRunOverrideToRawCase(testCase, entry.run)),
        );
      }
    }
  }

  return { rawCases, importedSuiteTests };
}

async function resolveIncludePaths(
  includePath: string,
  evalFileDir: string,
): Promise<readonly string[]> {
  const absolutePattern = path.resolve(evalFileDir, includePath);
  if (hasGlobMagic(includePath)) {
    const matches = await fg(absolutePattern.replaceAll('\\', '/'), {
      onlyFiles: true,
      absolute: true,
    });
    return dedupeResolvedPathsByIdentity([...new Set(matches.sort())]);
  }
  return [absolutePattern];
}

async function loadRawCasesForInclude(includePath: string): Promise<readonly JsonObject[]> {
  if (/\.eval\.ya?ml$/i.test(includePath)) {
    const raw = interpolateEnv(
      parseYamlValue(await readFile(includePath, 'utf8')),
      process.env,
    ) as unknown;
    if (!isJsonObject(raw)) {
      throw new Error(`Imported eval suite must be a YAML object: ${includePath}`);
    }
    const tests = resolveTests(raw as RawTestSuite);
    if (typeof tests === 'string') {
      const externalPath = path.resolve(path.dirname(includePath), tests);
      const pathStat = await stat(externalPath).catch(() => undefined);
      return pathStat?.isDirectory()
        ? loadCasesFromDirectory(externalPath)
        : loadCasesFromFile(externalPath);
    }
    if (Array.isArray(tests)) {
      const expanded = await expandFileReferences(tests, path.dirname(includePath));
      return expanded.filter(isJsonObject);
    }
    return [];
  }
  const pathStat = await stat(includePath).catch(() => undefined);
  return pathStat?.isDirectory()
    ? loadCasesFromDirectory(includePath)
    : loadCasesFromFile(includePath);
}

async function loadRawCasesFromShorthand(
  rawPath: string,
  evalFileDir: string,
): Promise<readonly JsonObject[]> {
  const resolvedPaths = await resolveIncludePaths(rawPath.trim(), evalFileDir);
  const rawCases: JsonObject[] = [];
  for (const resolvedPath of resolvedPaths) {
    if (/\.eval\.ya?ml$/i.test(resolvedPath)) {
      throw new Error(
        `tests shorthand imports raw case files only. Use an include entry with type: suite to import eval suites: ${rawPath}`,
      );
    }
    rawCases.push(...(await loadRawCasesForInclude(resolvedPath)));
  }
  return rawCases;
}

async function expandInlineTestEntries(params: {
  readonly entries: readonly JsonValue[];
  readonly evalFileDir: string;
  readonly repoRoot: URL | string;
  readonly suiteMetadataPayload?: Record<string, unknown>;
  readonly parentWorkspaceLocation?: string;
  readonly options?: LoadOptions;
}): Promise<ExpandedInlineTestEntries> {
  const withFileReferences = await expandFileReferences(params.entries, params.evalFileDir);
  const rawCases: JsonValue[] = [];
  const importedSuiteTests: EvalTest[] = [];

  for (const entry of withFileReferences) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      rawCases.push(...(await loadRawCasesFromShorthand(entry, params.evalFileDir)));
      continue;
    }

    if (!isIncludeEntry(entry)) {
      rawCases.push(entry);
      continue;
    }

    const expanded = await expandImportEntries({
      entries: [normalizeLegacyIncludeEntry(entry)],
      evalFileDir: params.evalFileDir,
      repoRoot: params.repoRoot,
      suiteMetadataPayload: params.suiteMetadataPayload,
      parentWorkspaceLocation: params.parentWorkspaceLocation,
      options: params.options,
    });
    rawCases.push(...expanded.rawCases);
    importedSuiteTests.push(...expanded.importedSuiteTests);
  }

  return { rawCases, importedSuiteTests };
}

function parentWorkspaceLocation(suite: RawTestSuite): string | undefined {
  if (suite.workspace !== undefined) {
    return 'workspace';
  }

  const runtime = suite.execution;
  if (isJsonObject(runtime) && runtime.workspace !== undefined) {
    return 'execution.workspace';
  }

  return undefined;
}

function readSuiteRuntimeBlock(suite: RawTestSuite, evalFilePath: string): JsonObject | undefined {
  if (suite.experiment !== undefined) {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'experiment' has been removed. Move experiment.target to top-level 'target' and move repeat, early_exit, timeout_seconds, threshold, and budget_usd under top-level 'policy'.`,
    );
  }
  const runtime = suite.execution;
  return isJsonObject(runtime) ? runtime : undefined;
}

function normalizeSuiteExperimentConfig(parsed: JsonObject): ExperimentConfig | undefined {
  const suite = parsed as RawTestSuite;
  const runtime = readSuiteRuntimeBlock(suite, 'eval file');
  const policy = isJsonObject(suite.policy) ? suite.policy : undefined;
  rejectCamelCasePolicyFields(policy);
  const target = asString(suite.target);
  if (!runtime && !policy && !target) {
    return undefined;
  }
  return normalizeExperimentConfig({
    ...(runtime ?? {}),
    ...(target !== undefined ? { target } : {}),
    ...(policy ?? {}),
  });
}

function rejectCamelCasePolicyFields(policy: JsonObject | undefined): void {
  if (!policy) {
    return;
  }
  const camelCasePolicyFields = ['earlyExit', 'timeoutSeconds', 'budgetUsd'];
  for (const field of camelCasePolicyFields) {
    if (policy[field] !== undefined) {
      throw new Error(
        `Invalid policy.${field}. Eval YAML uses snake_case; use policy.${toSnakeCase(field)}.`,
      );
    }
  }
  const repeat = policy.repeat;
  if (isJsonObject(repeat) && repeat.costLimitUsd !== undefined) {
    throw new Error(
      'Invalid policy.repeat.costLimitUsd. Eval YAML uses snake_case; use policy.repeat.cost_limit_usd.',
    );
  }
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const SOURCE_SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)/i;
const REDACTED_SOURCE_VALUE = '[redacted]';

function buildRawInlineTestSnapshots(rawParsed: unknown): Map<string, string> {
  const snapshots = new Map<string, string>();
  if (!isJsonObject(rawParsed)) {
    return snapshots;
  }

  const rawTests =
    rawParsed.tests ?? rawParsed.eval_cases ?? (rawParsed as Record<string, unknown>).evalcases;
  if (!Array.isArray(rawTests)) {
    return snapshots;
  }

  for (const rawTest of rawTests) {
    if (!isJsonObject(rawTest) || typeof rawTest.id !== 'string') {
      continue;
    }
    snapshots.set(rawTest.id, stringifySourceYaml(rawTest));
  }
  return snapshots;
}

function buildEvalTestSource(params: {
  readonly evalFilePath: string;
  readonly absoluteTestPath: string;
  readonly repoRootPath: string;
  readonly id: string;
  readonly renderedCase: RawEvalCase;
  readonly rawCaseSnapshots: ReadonlyMap<string, string>;
  readonly inputMessages: readonly TestMessage[];
  readonly evaluators: readonly GraderConfig[] | undefined;
  readonly assertionTemplateReferences: readonly EvalSourceReference[];
}): EvalTestSource {
  const evalFileRepoPath = toPortableRelativePath(params.repoRootPath, params.absoluteTestPath);
  const testSnapshotYaml =
    params.rawCaseSnapshots.get(params.id) ?? stringifySourceYaml(params.renderedCase);
  const evaluatorReferences = collectGraderSourceReferences(params.evaluators);
  const inputReferences = collectInputSourceReferences(params.inputMessages);
  const references = dedupeSourceReferences([
    ...inputReferences,
    ...evaluatorReferences,
    ...params.assertionTemplateReferences,
  ]);

  return {
    evalFilePath: params.evalFilePath,
    evalFileAbsolutePath: params.absoluteTestPath,
    ...(evalFileRepoPath ? { evalFileRepoPath } : {}),
    testId: params.id,
    testSnapshotYaml,
    graderDefinitions: buildGraderSourceDefinitions(params.evaluators),
    references,
  };
}

function stringifySourceYaml(value: unknown): string {
  return stringifyYaml(sanitizeSourceValue(value), { lineWidth: 0 }).trimEnd();
}

function sanitizeSourceValue(value: unknown, keyHint?: string): JsonValue {
  if (keyHint && SOURCE_SECRET_KEY_PATTERN.test(keyHint)) {
    return REDACTED_SOURCE_VALUE;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSourceValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      sanitizeSourceValue(entryValue, key),
    ]);
    return Object.fromEntries(entries) as JsonObject;
  }
  return String(value);
}

function buildGraderSourceDefinitions(
  evaluators: readonly GraderConfig[] | undefined,
): readonly EvalGraderSource[] {
  return (evaluators ?? []).map((evaluator) => ({
    name: evaluator.name,
    type: evaluator.type,
    ...(evaluator.weight !== undefined ? { weight: evaluator.weight } : {}),
    ...(evaluator.required !== undefined ? { required: evaluator.required } : {}),
    ...('min_score' in evaluator && evaluator.min_score !== undefined
      ? { minScore: evaluator.min_score }
      : {}),
    definition: sanitizeGraderDefinition(evaluator),
  }));
}

function sanitizeGraderDefinition(evaluator: GraderConfig): JsonObject {
  const copy = sanitizeSourceValue(evaluator) as JsonObject;
  return stripRuntimeResolutionFields(copy);
}

function stripRuntimeResolutionFields(value: JsonObject): JsonObject {
  const stripped: Record<string, JsonValue> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (
      key === 'resolvedPromptPath' ||
      key === 'promptPath' ||
      key === 'resolvedPromptScript' ||
      key === 'resolvedScriptPath' ||
      key === 'resolvedCwd' ||
      key === 'resolvedCommand'
    ) {
      continue;
    }
    if (Array.isArray(entryValue)) {
      stripped[key] = entryValue.map((item) =>
        isJsonObject(item) ? stripRuntimeResolutionFields(item) : item,
      ) as JsonValue;
    } else if (isJsonObject(entryValue)) {
      stripped[key] = stripRuntimeResolutionFields(entryValue);
    } else {
      stripped[key] = entryValue;
    }
  }
  return stripped as JsonObject;
}

function collectInputSourceReferences(
  inputMessages: readonly TestMessage[],
): readonly EvalSourceReference[] {
  const references: EvalSourceReference[] = [];
  for (const message of inputMessages) {
    if (!Array.isArray(message.content)) {
      continue;
    }
    for (const segment of message.content) {
      if (!isJsonObject(segment) || segment.type !== 'file') {
        continue;
      }
      const displayPath =
        typeof segment.path === 'string'
          ? segment.path
          : typeof segment.value === 'string'
            ? segment.value
            : 'input file';
      references.push({
        kind: 'input_file',
        displayPath,
        ...(typeof segment.resolvedPath === 'string'
          ? { resolvedPath: path.resolve(segment.resolvedPath) }
          : {}),
      });
    }
  }
  return references;
}

function collectGraderSourceReferences(
  evaluators: readonly GraderConfig[] | undefined,
): readonly EvalSourceReference[] {
  const references: EvalSourceReference[] = [];
  for (const evaluator of evaluators ?? []) {
    references.push(...collectSingleGraderSourceReferences(evaluator));
  }
  return references;
}

function collectSingleGraderSourceReferences(
  evaluator: GraderConfig,
): readonly EvalSourceReference[] {
  const references: EvalSourceReference[] = [];

  if (evaluator.type === 'code-grader') {
    const command = evaluator.command ?? evaluator.script ?? [];
    references.push({
      kind: 'code_grader_command',
      displayPath: evaluator.resolvedScriptPath ?? command.join(' '),
      ...(evaluator.resolvedScriptPath ? { resolvedPath: evaluator.resolvedScriptPath } : {}),
      graderName: evaluator.name,
      command,
    });
    if (evaluator.resolvedCwd) {
      references.push({
        kind: 'code_grader_cwd',
        displayPath: evaluator.cwd ?? evaluator.resolvedCwd,
        resolvedPath: evaluator.resolvedCwd,
        graderName: evaluator.name,
      });
    }
  }

  if (evaluator.type === 'llm-grader') {
    const promptPath = evaluator.resolvedPromptPath ?? evaluator.promptPath;
    if (promptPath) {
      references.push({
        kind: 'llm_grader_prompt',
        displayPath: typeof evaluator.prompt === 'string' ? evaluator.prompt : promptPath,
        resolvedPath: promptPath,
        graderName: evaluator.name,
      });
    }
    if (evaluator.resolvedPromptScript && evaluator.resolvedPromptScript.length > 0) {
      references.push({
        kind: 'prompt_script',
        displayPath: evaluator.resolvedPromptScript.at(-1) ?? evaluator.name,
        resolvedPath: evaluator.resolvedPromptScript.at(-1),
        graderName: evaluator.name,
        command: evaluator.resolvedPromptScript,
      });
    }
  }

  const preprocessors = 'preprocessors' in evaluator ? evaluator.preprocessors : undefined;
  for (const preprocessor of preprocessors ?? []) {
    if (preprocessor.resolvedCommand && preprocessor.resolvedCommand.length > 0) {
      references.push({
        kind: 'preprocessor_command',
        displayPath: preprocessor.resolvedCommand.at(-1) ?? preprocessor.type,
        resolvedPath: preprocessor.resolvedCommand.at(-1),
        graderName: evaluator.name,
        command: preprocessor.resolvedCommand,
      });
    }
  }

  if (evaluator.type === 'composite') {
    for (const member of evaluator.assertions) {
      references.push(...collectSingleGraderSourceReferences(member));
    }
    if (evaluator.aggregator.type === 'code-grader') {
      references.push({
        kind: 'code_grader_command',
        displayPath: evaluator.aggregator.path,
        resolvedPath: path.resolve(evaluator.aggregator.cwd ?? '', evaluator.aggregator.path),
        graderName: evaluator.name,
      });
    } else if (evaluator.aggregator.type === 'llm-grader' && evaluator.aggregator.promptPath) {
      references.push({
        kind: 'llm_grader_prompt',
        displayPath: evaluator.aggregator.prompt ?? evaluator.aggregator.promptPath,
        resolvedPath: evaluator.aggregator.promptPath,
        graderName: evaluator.name,
      });
    }
  }

  return references;
}

function dedupeSourceReferences(
  references: readonly EvalSourceReference[],
): readonly EvalSourceReference[] {
  const seen = new Set<string>();
  const deduped: EvalSourceReference[] = [];
  for (const reference of references) {
    const key = JSON.stringify([
      reference.kind,
      reference.resolvedPath ?? reference.displayPath,
      reference.graderName ?? '',
      reference.command?.join('\u0000') ?? '',
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(reference);
  }
  return deduped;
}

function toPortableRelativePath(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return undefined;
}

/**
 * Load a single test by exact ID match.
 * Throws if the ID is not found.
 */
export async function loadTestById(
  evalFilePath: string,
  repoRoot: URL | string,
  evalId: string,
): Promise<EvalTest> {
  const tests = await loadTests(evalFilePath, repoRoot);
  const match = tests.find((c) => c.id === evalId);
  if (!match) {
    const available = tests.map((c) => c.id).join(', ');
    throw new Error(`Test '${evalId}' not found in ${evalFilePath}. Available IDs: ${available}`);
  }
  return match;
}

/** @deprecated Use `loadTestById` instead */
export const loadEvalCaseById = loadTestById;

/**
 * Parse raw turn data from YAML into typed ConversationTurn objects.
 * String assertions are preserved as-is — they become rubric criteria at runtime.
 * Structured assertion objects pass through unchanged.
 */
function parseTurns(rawTurns: readonly unknown[]): ConversationTurn[] {
  return rawTurns.map((rawTurn) => {
    const turn = rawTurn as Record<string, unknown>;
    const input = turn.input as TestMessageContent;
    const expectedOutput = turn.expected_output as TestMessageContent | undefined;

    // Parse per-turn assertions (string shorthand or structured evaluator config)
    let assertions: (string | GraderConfig)[] | undefined;
    if (Array.isArray(turn.assertions)) {
      assertions = turn.assertions.map((a: unknown) => {
        if (typeof a === 'string') return a;
        // Structured evaluator config — pass through as-is (validated by Zod schema)
        return a as GraderConfig;
      });
    }

    return {
      input,
      ...(expectedOutput !== undefined ? { expected_output: expectedOutput } : {}),
      ...(assertions && assertions.length > 0 ? { assertions } : {}),
    };
  });
}

/**
 * Normalize a command value from YAML into a string array.
 * Accepts a string (split on whitespace) or an array of strings.
 */
function parseCommandArray(source: unknown): string[] | undefined {
  if (typeof source === 'string') {
    const parts = source.trim().split(/\s+/);
    return parts.length > 0 && parts[0] !== '' ? parts : undefined;
  }
  if (Array.isArray(source)) {
    const arr = source.filter((s): s is string => typeof s === 'string');
    return arr.length > 0 ? arr : undefined;
  }
  return undefined;
}

/**
 * Parse a WorkspaceScriptConfig from raw YAML value.
 * Accepts both `command` (preferred) and `script` (deprecated alias).
 * Command can be an array of strings or a single string (auto-split on whitespace).
 * Note: string commands are split naively on whitespace. For arguments containing
 * spaces, use the array form: command: ["node", "path with spaces/setup.mjs"]
 */
function parseWorkspaceScriptConfig(
  raw: unknown,
  evalFileDir: string,
): WorkspaceScriptConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  // Precedence: command > script (deprecated)
  if (obj.script !== undefined && obj.command === undefined) {
    logWarning("'script' is deprecated. Use 'command' instead.");
  }

  const command = parseCommandArray(obj.command ?? obj.script);
  if (!command) return undefined;

  const timeoutMs = typeof obj.timeout_ms === 'number' ? obj.timeout_ms : undefined;
  let cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;

  // Resolve relative cwd against eval file directory
  if (cwd && !path.isAbsolute(cwd)) {
    cwd = path.resolve(evalFileDir, cwd);
  }

  const config: WorkspaceScriptConfig = { command };
  if (timeoutMs !== undefined) {
    return { ...config, timeout_ms: timeoutMs, ...(cwd !== undefined && { cwd }) };
  }
  return cwd ? { ...config, cwd } : config;
}

function parseWorkspaceHookConfig(
  raw: unknown,
  evalFileDir: string,
): WorkspaceHookConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const script = parseWorkspaceScriptConfig(raw, evalFileDir);
  const obj = raw as Record<string, unknown>;
  const reset =
    obj.reset === 'none' || obj.reset === 'fast' || obj.reset === 'strict' ? obj.reset : undefined;
  if (!script && !reset) return undefined;
  return {
    ...(script ?? {}),
    ...(reset !== undefined && { reset }),
  };
}

function parseWorkspaceHooksConfig(
  raw: unknown,
  evalFileDir: string,
): WorkspaceHooksConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : undefined;
  const beforeAll = parseWorkspaceHookConfig(obj.before_all, evalFileDir);
  const beforeEach = parseWorkspaceHookConfig(obj.before_each, evalFileDir);
  const afterEach = parseWorkspaceHookConfig(obj.after_each, evalFileDir);
  const afterAll = parseWorkspaceHookConfig(obj.after_all, evalFileDir);
  const hooks: WorkspaceHooksConfig = {
    ...(enabled !== undefined && { enabled }),
    ...(beforeAll !== undefined && { before_all: beforeAll }),
    ...(beforeEach !== undefined && { before_each: beforeEach }),
    ...(afterEach !== undefined && { after_each: afterEach }),
    ...(afterAll !== undefined && { after_all: afterAll }),
  };
  return Object.keys(hooks).length > 0 ? hooks : undefined;
}

/**
 * Resolve a workspace config value: either an inline object or a string path
 * to an external workspace YAML file.
 *
 * When `raw` is a string, the file is loaded and parsed relative to evalFileDir.
 * Relative paths inside the external file (template, cwd, local repo paths)
 * are resolved relative to the workspace file's own directory.
 */
async function resolveWorkspaceConfig(
  raw: unknown,
  evalFileDir: string,
): Promise<WorkspaceConfig | undefined> {
  if (typeof raw === 'string') {
    const workspaceFilePath = path.resolve(evalFileDir, raw);
    let content: string;
    try {
      content = await readFile(workspaceFilePath, 'utf8');
    } catch {
      throw new Error(`Workspace file not found: ${raw} (resolved to ${workspaceFilePath})`);
    }
    const parsed = interpolateEnv(parseYamlValue(content), process.env) as unknown;
    if (!isJsonObject(parsed)) {
      throw new Error(
        `Invalid workspace file format: ${workspaceFilePath} (expected a YAML object)`,
      );
    }
    // Resolve paths relative to the workspace file's directory
    const workspaceFileDir = path.dirname(workspaceFilePath);
    const resolvedWorkspace = parseWorkspaceConfig(parsed, workspaceFileDir);
    if (resolvedWorkspace) {
      return { ...resolvedWorkspace, workspaceFileDir };
    }

    const parsedObject = parsed as Record<string, unknown>;
    if ('workspace' in parsedObject && isJsonObject(parsedObject.workspace)) {
      throw new Error(
        [
          `Invalid workspace file format: ${workspaceFilePath}`,
          'External workspace files must contain the workspace config object directly.',
          'Remove the top-level "workspace:" wrapper.',
        ].join(' '),
      );
    }

    return undefined;
  }
  return parseWorkspaceConfig(raw, evalFileDir);
}

/**
 * Parse a WorkspaceConfig from raw YAML value.
 */
function parseWorkspaceConfig(raw: unknown, evalFileDir: string): WorkspaceConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if ('static_path' in obj) {
    throw new Error(
      'workspace.static_path has been removed from eval YAML. Put existing workspace paths in .agentv/config.local.yaml execution.workspace_path or pass --workspace-path.',
    );
  }
  if ('pool' in obj) {
    throw new Error(
      'workspace.pool has been removed from eval YAML. Shared repo workspaces are pooled by default; use --workspace-mode or config.local.yaml execution.workspace_mode for machine-local runtime overrides.',
    );
  }
  if ('static' in obj) {
    throw new Error(
      'workspace.static has been removed from eval YAML. Put existing workspace paths in .agentv/config.local.yaml execution.workspace_path or pass --workspace-path.',
    );
  }
  if ('mode' in obj) {
    throw new Error(
      'workspace.mode has been removed from eval YAML. Use workspace.isolation: shared|per_case for folder isolation; use --workspace-mode or config.local.yaml execution.workspace_mode only for machine-local runtime overrides.',
    );
  }
  if ('path' in obj) {
    throw new Error(
      'workspace.path has been removed from eval YAML. Put existing workspace paths in .agentv/config.local.yaml execution.workspace_path or pass --workspace-path.',
    );
  }

  let template = typeof obj.template === 'string' ? obj.template : undefined;
  if (template && !path.isAbsolute(template)) {
    template = path.resolve(evalFileDir, template);
  }

  if (obj.isolation !== undefined && obj.isolation !== 'shared' && obj.isolation !== 'per_case') {
    throw new Error("workspace.isolation must be 'shared' or 'per_case'.");
  }
  const isolation =
    obj.isolation === 'shared' || obj.isolation === 'per_case' ? obj.isolation : undefined;

  const repos = Array.isArray(obj.repos)
    ? ((obj.repos as Record<string, unknown>[])
        .map(parseRepoConfig)
        .filter(Boolean) as RepoConfig[])
    : undefined;

  const hooks = parseWorkspaceHooksConfig(obj.hooks, evalFileDir);

  const docker = parseDockerWorkspaceConfig(obj.docker);
  const env = parseWorkspaceEnvConfig(obj.env);

  if (!template && !isolation && !repos && !hooks && !docker && !env) return undefined;

  return {
    ...(template !== undefined && { template }),
    ...(isolation !== undefined && { isolation }),
    ...(repos !== undefined && { repos }),
    ...(hooks !== undefined && { hooks }),
    ...(docker !== undefined && { docker }),
    ...(env !== undefined && { env }),
  };
}

function parseWorkspaceEnvConfig(raw: unknown): WorkspaceEnvConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const required_commands = Array.isArray(obj.required_commands)
    ? (obj.required_commands.filter((c) => typeof c === 'string') as string[])
    : undefined;
  const required_python_modules = Array.isArray(obj.required_python_modules)
    ? (obj.required_python_modules.filter((m) => typeof m === 'string') as string[])
    : undefined;

  if (!required_commands?.length && !required_python_modules?.length) return undefined;

  return {
    ...(required_commands?.length && { required_commands }),
    ...(required_python_modules?.length && { required_python_modules }),
  };
}

/**
 * Parse a DockerWorkspaceConfig from raw YAML value.
 */
function parseDockerWorkspaceConfig(raw: unknown): DockerWorkspaceConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.image !== 'string') return undefined;

  return {
    image: obj.image,
    ...(typeof obj.timeout === 'number' && { timeout: obj.timeout }),
    ...(typeof obj.memory === 'string' && { memory: obj.memory }),
    ...(typeof obj.cpus === 'number' && { cpus: obj.cpus }),
  };
}

/**
 * Merge case-level workspace config with suite-level defaults.
 * Strategy: case-level fields replace suite-level fields.
 */
function mergeWorkspaceConfigs(
  suiteLevel: WorkspaceConfig | undefined,
  caseLevel: WorkspaceConfig | undefined,
): WorkspaceConfig | undefined {
  if (!suiteLevel && !caseLevel) return undefined;
  if (!suiteLevel) return caseLevel;
  if (!caseLevel) return suiteLevel;

  const mergeHook = (
    suiteHook: WorkspaceHookConfig | undefined,
    caseHook: WorkspaceHookConfig | undefined,
  ): WorkspaceHookConfig | undefined => {
    if (!suiteHook && !caseHook) return undefined;
    return {
      ...(suiteHook ?? {}),
      ...(caseHook ?? {}),
    };
  };
  const mergedEnabled = caseLevel.hooks?.enabled ?? suiteLevel.hooks?.enabled;
  const mergedHooks = {
    ...(mergedEnabled !== undefined && { enabled: mergedEnabled }),
    before_all: mergeHook(suiteLevel.hooks?.before_all, caseLevel.hooks?.before_all),
    before_each: mergeHook(suiteLevel.hooks?.before_each, caseLevel.hooks?.before_each),
    after_each: mergeHook(suiteLevel.hooks?.after_each, caseLevel.hooks?.after_each),
    after_all: mergeHook(suiteLevel.hooks?.after_all, caseLevel.hooks?.after_all),
  };
  const hasHooks =
    mergedEnabled !== undefined ||
    Object.values(mergedHooks).some((hook) => hook !== undefined && typeof hook === 'object');

  return {
    template: caseLevel.template ?? suiteLevel.template,
    isolation: caseLevel.isolation ?? suiteLevel.isolation,
    repos: caseLevel.repos ?? suiteLevel.repos,
    ...(hasHooks && { hooks: mergedHooks as WorkspaceHooksConfig }),
    docker: caseLevel.docker ?? suiteLevel.docker,
    env: caseLevel.env ?? suiteLevel.env,
    workspaceFileDir: caseLevel.workspaceFileDir ?? suiteLevel.workspaceFileDir,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Build metadata defaults inherited by each test case. Top-level `metadata:` carries
 * arbitrary domain/source fields; top-level `governance:` wins over nested
 * `metadata.governance:` so existing governance evals keep their precedence.
 */
function extractSuiteMetadataPayload(suite: RawTestSuite): Record<string, unknown> | undefined {
  const payload = isJsonObject(suite.metadata)
    ? ({ ...(suite.metadata as Record<string, unknown>) } as Record<string, unknown>)
    : {};

  const suiteTags = readMetadataTags(suite.tags);
  const metadataTags = readMetadataTags(payload.tags);
  if (suiteTags.length > 0 || metadataTags.length > 0) {
    payload.tags = dedupeMetadataArray([...suiteTags, ...metadataTags]);
  }

  const top = (suite as JsonObject).governance;
  if (isJsonObject(top)) {
    payload.governance = top as Record<string, unknown>;
  } else {
    const nested = payload.governance;
    if (isJsonObject(nested)) {
      payload.governance = nested as Record<string, unknown>;
    }
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function readMetadataTags(value: unknown): readonly string[] {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }
  return [];
}

function dedupeMetadataArray(values: readonly unknown[]): readonly unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const value of values) {
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * Merge a suite-level metadata payload into a case's metadata map. The same rules apply to
 * every key in the payload: arrays concatenate suite-first and deduplicate; nested objects
 * recurse; scalar fields on the case win; suite fills in keys the case omits.
 */
function mergeSuiteMetadataPayload(
  caseMetadata: Record<string, unknown> | undefined,
  suitePayload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!suitePayload) return caseMetadata;

  const result: Record<string, unknown> = { ...(caseMetadata ?? {}) };
  for (const [key, suiteVal] of Object.entries(suitePayload)) {
    const caseVal = result[key];
    if (Array.isArray(suiteVal) && Array.isArray(caseVal)) {
      result[key] = dedupeMetadataArray([...suiteVal, ...caseVal]);
    } else if (isJsonObject(suiteVal) && isJsonObject(caseVal)) {
      result[key] = mergeSuiteMetadataPayload(
        caseVal as Record<string, unknown>,
        suiteVal as Record<string, unknown>,
      );
    } else if (caseVal === undefined) {
      result[key] = suiteVal;
    }
  }
  return result;
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
