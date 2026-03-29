import { readFile } from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';
import { parse } from 'yaml';

import { collectResolvedInputFilePaths } from './input-message-utils.js';
import { interpolateEnv } from './interpolation.js';
import { loadTestsFromAgentSkills } from './loaders/agent-skills-parser.js';
import { expandFileReferences, loadCasesFromFile } from './loaders/case-file-loader.js';
import {
  extractCacheConfig,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetsFromSuite,
  extractTargetsFromTestCase,
  extractThreshold,
  extractTotalBudgetUsd,
  extractTrialsConfig,
  extractWorkersFromSuite,
  loadConfig,
} from './loaders/config-loader.js';
import {
  coerceEvaluator,
  parseEvaluators,
  parseInlineRubrics,
  warnUnconsumedCriteria,
} from './loaders/evaluator-parser.js';
import { buildSearchRoots, resolveToAbsolutePath } from './loaders/file-resolver.js';
import { detectFormat, loadTestsFromJsonl } from './loaders/jsonl-parser.js';
import { processExpectedMessages, processMessages } from './loaders/message-processor.js';
import {
  expandInputShorthand,
  resolveExpectedMessages,
  resolveInputMessages,
} from './loaders/shorthand-expansion.js';
import { parseMetadata } from './metadata.js';
import type {
  EvalTest,
  JsonObject,
  JsonValue,
  RepoCheckout,
  RepoClone,
  RepoConfig,
  RepoSource,
  TestMessage,
  TrialsConfig,
  WorkspaceConfig,
  WorkspaceHookConfig,
  WorkspaceHooksConfig,
  WorkspaceScriptConfig,
} from './types.js';
import { isJsonObject, isTestMessage } from './types.js';

// Re-export public APIs from modules
export { buildPromptInputs, type PromptInputs } from './formatting/prompt-builder.js';
export {
  DEFAULT_EVAL_PATTERNS,
  extractCacheConfig,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetsFromSuite,
  extractTargetsFromTestCase,
  extractThreshold,
  extractTrialsConfig,
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
  /** Filter tests by ID pattern (glob supported, e.g., "summary-*") */
  readonly filter?: string;
  /** Category derived from the eval file's directory path */
  readonly category?: string;
};

type RawTestSuite = JsonObject & {
  readonly tests?: JsonValue;
  /** @deprecated Use `tests` instead */
  readonly eval_cases?: JsonValue;
  /** @deprecated Use `tests` instead */
  readonly evalcases?: JsonValue;
  readonly target?: JsonValue;
  readonly execution?: JsonValue;
  readonly workspace?: JsonValue;
  readonly assertions?: JsonValue;
  /** @deprecated Use `assertions` instead */
  readonly assert?: JsonValue;
  readonly input?: JsonValue;
  /** Shorthand: list of file paths to prepend as type:file content blocks in each test's user message. */
  readonly input_files?: JsonValue;
  // Suite-level metadata fields
  readonly name?: JsonValue;
  readonly description?: JsonValue;
  readonly version?: JsonValue;
  readonly author?: JsonValue;
  readonly tags?: JsonValue;
  readonly license?: JsonValue;
  readonly requires?: JsonValue;
};

type RawEvalCase = JsonObject & {
  readonly id?: JsonValue;
  readonly conversation_id?: JsonValue;
  readonly criteria?: JsonValue;
  /** @deprecated Use `criteria` instead */
  readonly expected_outcome?: JsonValue;
  readonly input?: JsonValue;
  /** Shorthand: list of file paths to prepend as type:file content blocks in the user message. */
  readonly input_files?: JsonValue;
  readonly expected_output?: JsonValue;
  readonly execution?: JsonValue;
  readonly evaluators?: JsonValue;
  readonly assertions?: JsonValue;
  /** @deprecated Use `assertions` instead */
  readonly assert?: JsonValue;
  readonly rubrics?: JsonValue;
  readonly workspace?: JsonValue;
  readonly metadata?: JsonValue;
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

/**
 * Read metadata from a test suite file (like target name).
 * This is a convenience function for CLI tools that need metadata without loading all tests.
 */
export async function readTestSuiteMetadata(
  testFilePath: string,
): Promise<{ target?: string; targets?: readonly string[]; trials?: TrialsConfig }> {
  try {
    const absolutePath = path.resolve(testFilePath);
    const content = await readFile(absolutePath, 'utf8');
    const parsed = interpolateEnv(parse(content), process.env) as unknown;

    if (!isJsonObject(parsed)) {
      return {};
    }

    return {
      target: extractTargetFromSuite(parsed),
      targets: extractTargetsFromSuite(parsed),
      trials: extractTrialsConfig(parsed),
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
  readonly trials?: TrialsConfig;
  /** Suite-level targets from execution.targets (matrix evaluation) */
  readonly targets?: readonly string[];
  /** Suite-level workers from execution.workers */
  readonly workers?: number;
  /** Suite-level cache config from execution.cache */
  readonly cacheConfig?: import('./loaders/config-loader.js').CacheConfig;
  /** Suite-level metadata (name, description, version, etc.) */
  readonly metadata?: import('./metadata.js').EvalMetadata;
  /** Suite-level total cost budget in USD */
  readonly totalBudgetUsd?: number;
  /** Execution error tolerance: true or false */
  readonly failOnError?: import('./types.js').FailOnError;
  /** Suite-level quality threshold (0-1) — suite fails if mean score is below */
  readonly threshold?: number;
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
  const { tests, parsed } = await loadTestsFromYaml(evalFilePath, repoRoot, options);
  const metadata = parseMetadata(parsed);
  const failOnError = extractFailOnError(parsed);
  const threshold = extractThreshold(parsed);
  return {
    tests,
    trials: extractTrialsConfig(parsed),
    targets: extractTargetsFromSuite(parsed),
    workers: extractWorkersFromSuite(parsed),
    cacheConfig: extractCacheConfig(parsed),
    totalBudgetUsd: extractTotalBudgetUsd(parsed),
    ...(metadata !== undefined && { metadata }),
    ...(failOnError !== undefined && { failOnError }),
    ...(threshold !== undefined && { threshold }),
  };
}

/** @deprecated Use `loadTestSuite` instead */
export const loadEvalSuite = loadTestSuite;

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
  // YAML parsing (existing implementation)
  const verbose = options?.verbose ?? false;
  const filterPattern = options?.filter;
  const absoluteTestPath = path.resolve(evalFilePath);

  const repoRootPath = resolveToAbsolutePath(repoRoot);
  const searchRoots = buildSearchRoots(absoluteTestPath, repoRootPath);

  // Load configuration (walks up directory tree to repo root)
  const config = await loadConfig(absoluteTestPath, repoRootPath);

  const rawFile = await readFile(absoluteTestPath, 'utf8');
  const interpolated = interpolateEnv(parse(rawFile), process.env) as unknown;
  if (!isJsonObject(interpolated)) {
    throw new Error(`Invalid test file format: ${evalFilePath}`);
  }

  const suite = interpolated as RawTestSuite;
  const evalSetNameFromSuite = asString(suite.name)?.trim();
  const fallbackEvalSet =
    path.basename(absoluteTestPath).replace(/\.eval\.ya?ml$/i, '').replace(/\.ya?ml$/i, '') ||
    'eval';
  const evalSetName =
    evalSetNameFromSuite && evalSetNameFromSuite.length > 0
      ? evalSetNameFromSuite
      : fallbackEvalSet;

  const rawTestcases = resolveTests(suite);

  const globalEvaluator = coerceEvaluator(suite.evaluator, 'global') ?? 'llm-grader';

  // Parse suite-level workspace config (default for all cases)
  const evalFileDir = path.dirname(absoluteTestPath);

  // Resolve tests: string path to external file, inline array, or error
  let expandedTestcases: readonly JsonValue[];
  if (typeof rawTestcases === 'string') {
    // String path: load tests from external file (YAML, JSONL)
    const externalPath = path.resolve(evalFileDir, rawTestcases);
    expandedTestcases = await loadCasesFromFile(externalPath);
  } else if (Array.isArray(rawTestcases)) {
    // Inline array: expand any file:// references
    expandedTestcases = await expandFileReferences(rawTestcases, evalFileDir);
  } else {
    throw new Error(`Invalid test file format: ${evalFilePath} - missing 'tests' field`);
  }

  const suiteWorkspace = await resolveWorkspaceConfig(suite.workspace, evalFileDir);

  // Resolve suite-level input (prepended to each test's input messages)
  const suiteInputMessages = expandInputShorthand(suite.input);

  // Suite-level input_files: passed to resolveInputMessages for each test
  const suiteInputFiles = suite.input_files;

  // Extract global target from execution.target (or legacy root-level target)
  const rawGlobalExecution = isJsonObject(suite.execution) ? suite.execution : undefined;
  const _globalTarget = asString(rawGlobalExecution?.target) ?? asString(suite.target);

  // Build global execution context, including suite-level assertions (which is a sibling of execution)
  // Also accept legacy `assert` key with a deprecation warning
  const suiteAssertions = suite.assertions ?? suite.assert;
  if (suite.assert !== undefined && suite.assertions === undefined) {
    logWarning("'assert' is deprecated at the suite level. Use 'assertions' instead.");
  }
  const globalExecution: JsonObject | undefined =
    suiteAssertions !== undefined
      ? { ...(rawGlobalExecution ?? {}), assertions: suiteAssertions }
      : rawGlobalExecution;

  const results: EvalTest[] = [];

  for (const rawEvalcase of expandedTestcases) {
    if (!isJsonObject(rawEvalcase)) {
      logWarning('Skipping invalid test entry (expected object)');
      continue;
    }

    const evalcase = rawEvalcase as RawEvalCase;
    const id = asString(evalcase.id);

    // Skip tests that don't match the filter pattern (glob supported)
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

    // Extract per-case execution config early (reused below for skip_defaults)
    const caseExecution = isJsonObject(evalcase.execution) ? evalcase.execution : undefined;
    const skipDefaults = caseExecution?.skip_defaults === true;

    // Resolve input with shorthand support (pass suite-level input_files for merge)
    const effectiveSuiteInputFiles = suiteInputFiles && !skipDefaults ? suiteInputFiles : undefined;
    const testInputMessages = resolveInputMessages(evalcase, effectiveSuiteInputFiles);
    // Resolve expected_output with shorthand support
    const expectedMessages = resolveExpectedMessages(evalcase) ?? [];

    // A test is complete when it has id, input, and at least one of: criteria, expected_output, or assertions
    const hasEvaluationSpec =
      !!outcome ||
      expectedMessages.length > 0 ||
      evalcase.assertions !== undefined ||
      evalcase.assert !== undefined;
    if (!id || !hasEvaluationSpec || !testInputMessages || testInputMessages.length === 0) {
      logError(
        `Skipping incomplete test: ${id ?? 'unknown'}. Missing required fields: id, input, and at least one of criteria/expected_output/assertions`,
      );
      continue;
    }

    // Prepend suite-level input to test input (respecting skip_defaults)
    const effectiveSuiteInputMessages =
      suiteInputMessages && !skipDefaults ? suiteInputMessages : undefined;

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

    const evalCaseEvaluatorKind = coerceEvaluator(evalcase.evaluator, id) ?? globalEvaluator;
    let evaluators: Awaited<ReturnType<typeof parseEvaluators>>;
    try {
      evaluators = await parseEvaluators(evalcase, globalExecution, searchRoots, id ?? 'unknown');
    } catch (error) {
      // Skip entire test if evaluator validation fails
      const message = error instanceof Error ? error.message : String(error);
      logError(`Skipping test '${id}': ${message}`);
      continue;
    }

    // Handle inline rubrics field (deprecated: use assertions: [{type: rubrics, criteria: [...]}] instead)
    const inlineRubrics = evalcase.rubrics;
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
    const caseWorkspace = await resolveWorkspaceConfig(evalcase.workspace, evalFileDir);
    const mergedWorkspace = mergeWorkspaceConfigs(suiteWorkspace, caseWorkspace);

    // Parse per-case metadata
    const metadata = isJsonObject(evalcase.metadata)
      ? (evalcase.metadata as Record<string, unknown>)
      : undefined;

    // Extract per-test targets override (matrix evaluation)
    const caseTargets = extractTargetsFromTestCase(evalcase as JsonObject);

    const testCase: EvalTest = {
      id,
      dataset: evalSetName,
      category: options?.category,
      conversation_id: conversationId,
      question: question,
      input: inputMessages,
      expected_output: outputSegments,
      reference_answer: referenceAnswer,
      file_paths: userFilePaths,
      criteria: outcome ?? '',
      evaluator: evalCaseEvaluatorKind,
      assertions: evaluators,
      workspace: mergedWorkspace,
      metadata,
      targets: caseTargets,
    };

    results.push(testCase);
  }

  return { tests: results, parsed: suite };
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

function parseRepoSource(raw: unknown): RepoSource | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.type === 'git' && typeof obj.url === 'string') {
    return { type: 'git', url: obj.url };
  }
  if (obj.type === 'local' && typeof obj.path === 'string') {
    return { type: 'local', path: obj.path };
  }
  return undefined;
}

function parseRepoCheckout(raw: unknown): RepoCheckout | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const ref = typeof obj.ref === 'string' ? obj.ref : undefined;
  const resolve = obj.resolve === 'remote' || obj.resolve === 'local' ? obj.resolve : undefined;
  const ancestor = typeof obj.ancestor === 'number' ? obj.ancestor : undefined;
  if (!ref && !resolve && ancestor === undefined) return undefined;
  return {
    ...(ref !== undefined && { ref }),
    ...(resolve !== undefined && { resolve }),
    ...(ancestor !== undefined && { ancestor }),
  };
}

function parseRepoClone(raw: unknown): RepoClone | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const depth = typeof obj.depth === 'number' ? obj.depth : undefined;
  const filter = typeof obj.filter === 'string' ? obj.filter : undefined;
  const sparse = Array.isArray(obj.sparse)
    ? obj.sparse.filter((s): s is string => typeof s === 'string')
    : undefined;
  if (depth === undefined && !filter && !sparse) return undefined;
  return {
    ...(depth !== undefined && { depth }),
    ...(filter !== undefined && { filter }),
    ...(sparse !== undefined && { sparse }),
  };
}

function parseRepoConfig(raw: unknown): RepoConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const repoPath = typeof obj.path === 'string' ? obj.path : undefined;
  const source = parseRepoSource(obj.source);
  if (!repoPath || !source) return undefined;
  const checkout = parseRepoCheckout(obj.checkout);
  const clone = parseRepoClone(obj.clone);
  return {
    path: repoPath,
    source,
    ...(checkout !== undefined && { checkout }),
    ...(clone !== undefined && { clone }),
  };
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
    const parsed = interpolateEnv(parse(content), process.env) as unknown;
    if (!isJsonObject(parsed)) {
      throw new Error(
        `Invalid workspace file format: ${workspaceFilePath} (expected a YAML object)`,
      );
    }
    // Resolve paths relative to the workspace file's directory
    const workspaceFileDir = path.dirname(workspaceFilePath);
    return parseWorkspaceConfig(parsed, workspaceFileDir);
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
      'workspace.static_path has been removed. Use workspace.path with workspace.mode=static.',
    );
  }
  if ('pool' in obj) {
    throw new Error("workspace.pool has been removed. Use workspace.mode='pooled' or 'temp'.");
  }
  if ('static' in obj) {
    throw new Error("workspace.static has been removed. Use workspace.mode='static'.");
  }

  let template = typeof obj.template === 'string' ? obj.template : undefined;
  if (template && !path.isAbsolute(template)) {
    template = path.resolve(evalFileDir, template);
  }

  const isolation =
    obj.isolation === 'shared' || obj.isolation === 'per_test' ? obj.isolation : undefined;

  const repos = Array.isArray(obj.repos)
    ? ((obj.repos as Record<string, unknown>[])
        .map(parseRepoConfig)
        .filter(Boolean) as RepoConfig[])
    : undefined;

  const hooks = parseWorkspaceHooksConfig(obj.hooks, evalFileDir);
  const explicitMode =
    obj.mode === 'pooled' || obj.mode === 'temp' || obj.mode === 'static' ? obj.mode : undefined;
  const workspacePath = typeof obj.path === 'string' ? obj.path : undefined;
  const mode = explicitMode ?? (workspacePath ? 'static' : undefined);

  if (!template && !isolation && !repos && !hooks && !mode && !workspacePath) return undefined;

  return {
    ...(template !== undefined && { template }),
    ...(isolation !== undefined && { isolation }),
    ...(repos !== undefined && { repos }),
    ...(hooks !== undefined && { hooks }),
    ...(mode !== undefined && { mode }),
    ...(workspacePath !== undefined && { path: workspacePath }),
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
    mode: caseLevel.mode ?? suiteLevel.mode,
    path: caseLevel.path ?? suiteLevel.path,
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
