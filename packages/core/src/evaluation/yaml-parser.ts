import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';
import micromatch from 'micromatch';
import { stringify as stringifyYaml } from 'yaml';

import { normalizeCategoryPath } from './category.js';
import {
  type ExperimentConfig,
  normalizeExperimentConfig,
  normalizeExperimentRunOverride,
} from './experiment.js';
import { executeScript } from './graders/script-grader.js';
import { collectResolvedInputFilePaths } from './input-message-utils.js';
import {
  type NunjucksFilterMap,
  createEvalConfigEnv,
  interpolateEnv,
  interpolateTemplateVars,
} from './interpolation.js';
import {
  expandFileReferences,
  loadCasesFromDirectory,
  loadCasesFromFile,
} from './loaders/case-file-loader.js';
import type { ConfigDefaults } from './loaders/config-graph.js';
import {
  type ReferenceMap,
  extractBudgetUsd,
  extractCacheConfig,
  extractDefaultTestRubricPrompt,
  extractDefaultTestThreshold,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetRefsFromSuite,
  extractTargetsFromSuite,
  extractThreshold,
  extractWorkersFromSuite,
  loadConfig,
  parseTargetHooks,
} from './loaders/config-loader.js';
import { resolveEnvironmentRecipe } from './loaders/environment-recipe.js';
import {
  buildSearchRoots,
  resolveFileReference,
  resolveToAbsolutePath,
} from './loaders/file-resolver.js';
import {
  coerceEvaluator,
  collectAssertionTemplateSourceReferences,
  parseGraders,
  warnUnconsumedCriteria,
} from './loaders/grader-parser.js';
import { detectFormat, loadTestsFromJsonl } from './loaders/jsonl-parser.js';
import { processExpectedMessages, processMessages } from './loaders/message-processor.js';
import { loadPromptMdFallback } from './loaders/prompt-md-fallback.js';
import { expandScenarioReferences } from './loaders/scenario-file-loader.js';
import {
  expandInputShorthand,
  resolveExpectedMessages,
  resolveInputMessages,
} from './loaders/shorthand-expansion.js';
import { parseTransformSpec } from './loaders/transform-parser.js';
import { parseMetadata } from './metadata.js';
import type { ProviderDefinition } from './providers/types.js';
import type {
  AgentRulesExtensionConfig,
  AgentRulesPaths,
  AgentVExtensionConfig,
  ConversationAggregation,
  ConversationMode,
  ConversationTurn,
  EvalGraderSource,
  EvalPromptIdentity,
  EvalRunOverride,
  EvalSourceReference,
  EvalTest,
  EvalTestSource,
  ExtensionLifecycleHook,
  GraderConfig,
  JsonObject,
  JsonValue,
  TargetHooksConfig,
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
import { parseYamlValue } from './yaml-loader.js';

// Re-export public APIs from modules
export { buildPromptInputs, type PromptInputs } from './formatting/prompt-builder.js';
export {
  DEFAULT_EVAL_PATTERNS,
  extractCacheConfig,
  extractDefaultTestRubricPrompt,
  extractDefaultTestThreshold,
  extractFailOnError,
  extractTargetFromSuite,
  extractTargetRefsFromSuite,
  extractTargetsFromSuite,
  extractThreshold,
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
  /** Internal TS SDK bridge compatibility; authored YAML files must keep the default strict mode. */
  readonly allowInternalExpectedOutput?: boolean;
};

type SuiteImportStackEntry = {
  readonly identity: string;
  readonly displayPath: string;
};

const KNOWN_TEST_EXECUTION_FIELDS = new Set([
  'assert',
  'assertions',
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
  readonly tests?: JsonValue;
  readonly scenarios?: JsonValue;
  readonly target?: JsonValue;
  readonly providers?: JsonValue;
  readonly model?: JsonValue;
  readonly experiment?: JsonValue;
  readonly execution?: JsonValue;
  readonly policy?: JsonValue;
  readonly repeat?: JsonValue;
  readonly runs?: JsonValue;
  readonly early_exit?: JsonValue;
  readonly timeout_seconds?: JsonValue;
  readonly evaluate_options?: JsonValue;
  readonly budget_usd?: JsonValue;
  readonly threshold?: JsonValue;
  readonly default_test?: JsonValue;
  readonly defaults?: JsonValue;
  readonly environment?: JsonValue;
  readonly workspace?: JsonValue;
  readonly assert?: JsonValue;
  readonly preprocessors?: JsonValue;
  readonly extensions?: JsonValue;
  readonly on_run_complete?: JsonValue;
  readonly nunjucks_filters?: JsonValue;
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
  readonly assert?: JsonValue;
  readonly environment?: JsonValue;
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

type RawScenario = JsonObject & {
  readonly description?: JsonValue;
  readonly config?: JsonValue;
  readonly tests?: JsonValue;
};

type PromptDefinition = {
  readonly identity: EvalPromptIdentity;
  readonly input: JsonValue;
};

type PromptExpansionResult = {
  readonly rawCases: readonly JsonValue[];
  readonly promptById: ReadonlyMap<string, EvalPromptIdentity>;
  readonly sourceTestIdById: ReadonlyMap<string, string>;
};

function removedEvalCasesAliasMessage(alias: 'eval_cases' | 'evalcases'): string {
  return `Top-level '${alias}' has been removed from authored eval YAML. Use 'tests' instead.`;
}

function rejectRemovedEvalCasesAliases(suite: RawTestSuite, evalFilePath: string): void {
  if ('eval_cases' in suite) {
    throw new Error(
      `Invalid eval file ${evalFilePath}: ${removedEvalCasesAliasMessage('eval_cases')}`,
    );
  }
  if ('evalcases' in suite) {
    throw new Error(
      `Invalid eval file ${evalFilePath}: ${removedEvalCasesAliasMessage('evalcases')}`,
    );
  }
}

function rejectRemovedScenarioRowFields(row: JsonObject, location: string): void {
  if (row.eval_cases !== undefined) {
    throw new Error(`${location}.eval_cases has been removed. Use ${location} fields directly.`);
  }
  if (row.evalcases !== undefined) {
    throw new Error(`${location}.evalcases has been removed. Use ${location} fields directly.`);
  }
  if (row.provider_output !== undefined) {
    throw new Error(
      `${location}.provider_output is not supported in authored AgentV YAML. Use an explicit deterministic target such as provider: cli for fixed outputs, or use a replay/fixture target for captured provider responses.`,
    );
  }
  if (row.input !== undefined) {
    throw new Error(
      `${location}.input has been removed from authored eval YAML. Put prompt text or chat/system/user messages in top-level 'prompts' and put row-specific data in ${location}.vars.`,
    );
  }
  if (row.expected_output !== undefined) {
    throw new Error(
      `${location}.expected_output has been removed from authored eval YAML. Put the reference answer in ${location}.vars.expected_output and consume it with an explicit assertion such as { type: 'llm-rubric', value: 'Matches the reference answer: {{ expected_output }}' }.`,
    );
  }
  rejectPostprocess(row, location);
  rejectPreprocessors(row, location);
  rejectPostprocess(row.options, `${location}.options`);
  if (Array.isArray(row.assert)) {
    row.assert.forEach((assertion, assertionIndex) => {
      rejectPostprocess(assertion, `${location}.assert[${assertionIndex}]`);
      rejectPreprocessors(assertion, `${location}.assert[${assertionIndex}]`);
    });
  }
}

function resolveTests(suite: RawTestSuite, evalFilePath: string): JsonValue | undefined {
  rejectRemovedEvalCasesAliases(suite, evalFilePath);
  if (suite.tests !== undefined) return suite.tests;
  return undefined;
}

function mergeJsonObjectFields(
  first: JsonValue | undefined,
  second: JsonValue | undefined,
): JsonObject | undefined {
  const merged = {
    ...(isJsonObject(first) ? first : {}),
    ...(isJsonObject(second) ? second : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function concatJsonArrayFields(
  first: JsonValue | undefined,
  second: JsonValue | undefined,
): readonly JsonValue[] | undefined {
  const merged = [
    ...(Array.isArray(first) ? first : first !== undefined ? [first] : []),
    ...(Array.isArray(second) ? second : second !== undefined ? [second] : []),
  ];
  return merged.length > 0 ? merged : undefined;
}

function mergeScenarioTestRows(
  config: JsonObject,
  test: JsonObject,
  scenarioIndex: number,
  configIndex: number,
  testIndex: number,
  testCount: number,
): JsonObject {
  const vars = mergeJsonObjectFields(config.vars, test.vars);
  const metadata = mergeJsonObjectFields(config.metadata, test.metadata);
  const options = mergeJsonObjectFields(config.options, test.options);
  const run = mergeJsonObjectFields(config.run, test.run);
  const assertions = concatJsonArrayFields(config.assert, test.assert);

  const id =
    typeof test.id === 'string' && test.id.trim().length > 0
      ? test.id
      : typeof config.id === 'string' && config.id.trim().length > 0
        ? testCount > 1
          ? `${config.id}__scenario_test_${testIndex + 1}`
          : config.id
        : stableScenarioTestId(scenarioIndex, configIndex, testIndex);

  return {
    ...config,
    ...test,
    ...(vars ? { vars } : {}),
    ...(metadata ? { metadata } : {}),
    ...(options ? { options } : {}),
    ...(run ? { run } : {}),
    ...(assertions ? { assert: assertions } : {}),
    id,
  };
}

function lowerScenariosIntoTests(suite: RawTestSuite, evalFilePath: string): readonly JsonValue[] {
  const scenarios = suite.scenarios;
  if (scenarios === undefined) {
    return [];
  }
  if (!Array.isArray(scenarios)) {
    throw new Error(`Invalid eval file ${evalFilePath}: scenarios must be an array.`);
  }

  const lowered: JsonValue[] = [];
  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
    const scenario = scenarios[scenarioIndex];
    if (!isJsonObject(scenario)) {
      throw new Error(
        `Invalid eval file ${evalFilePath}: scenarios[${scenarioIndex}] must be an object.`,
      );
    }

    const rawScenario = scenario as RawScenario;
    if (!Array.isArray(rawScenario.config)) {
      throw new Error(
        `Invalid eval file ${evalFilePath}: scenarios[${scenarioIndex}].config must be an array.`,
      );
    }
    if (!Array.isArray(rawScenario.tests)) {
      throw new Error(
        `Invalid eval file ${evalFilePath}: scenarios[${scenarioIndex}].tests must be an array.`,
      );
    }

    for (let configIndex = 0; configIndex < rawScenario.config.length; configIndex++) {
      const config = rawScenario.config[configIndex];
      if (!isJsonObject(config)) {
        throw new Error(
          `Invalid eval file ${evalFilePath}: scenarios[${scenarioIndex}].config[${configIndex}] must be an object.`,
        );
      }
      rejectRemovedScenarioRowFields(config, `scenarios[${scenarioIndex}].config[${configIndex}]`);
      for (let testIndex = 0; testIndex < rawScenario.tests.length; testIndex++) {
        const test = rawScenario.tests[testIndex];
        if (!isJsonObject(test)) {
          throw new Error(
            `Invalid eval file ${evalFilePath}: scenarios[${scenarioIndex}].tests[${testIndex}] must be an object.`,
          );
        }
        rejectRemovedScenarioRowFields(test, `scenarios[${scenarioIndex}].tests[${testIndex}]`);
        lowered.push(
          mergeScenarioTestRows(
            config,
            test,
            scenarioIndex,
            configIndex,
            testIndex,
            rawScenario.tests.length,
          ),
        );
      }
    }
  }

  return lowered;
}

function interpolateCaseField<T extends JsonValue | undefined>(
  value: T,
  vars: JsonObject | undefined,
  filters?: NunjucksFilterMap,
): T {
  if (!vars || value === undefined) {
    return value;
  }
  return interpolateTemplateVars(value, vars as Record<string, unknown>, filters) as T;
}

function interpolateCaseTurns(
  turns: JsonValue | undefined,
  vars: JsonObject | undefined,
  filters?: NunjucksFilterMap,
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
      input: interpolateCaseField(rawTurn.input, vars, filters),
      expected_output: interpolateCaseField(rawTurn.expected_output, vars, filters),
      assert: interpolateCaseField(rawTurn.assert, vars, filters),
    } satisfies JsonObject;
  });
}

function interpolateRawEvalCase(
  raw: RawEvalCase,
  vars: JsonObject | undefined,
  filters?: NunjucksFilterMap,
): RawEvalCase {
  if (!vars) {
    return raw;
  }

  return {
    ...raw,
    ...(raw.id !== undefined ? { id: interpolateCaseField(raw.id, vars, filters) } : {}),
    ...(raw.description !== undefined
      ? { description: interpolateCaseField(raw.description, vars, filters) }
      : {}),
    ...(raw.criteria !== undefined
      ? { criteria: interpolateCaseField(raw.criteria, vars, filters) }
      : {}),
    ...(raw.expected_outcome !== undefined
      ? { expected_outcome: interpolateCaseField(raw.expected_outcome, vars, filters) }
      : {}),
    ...(raw.input !== undefined ? { input: interpolateCaseField(raw.input, vars, filters) } : {}),
    ...(raw.input_files !== undefined
      ? { input_files: interpolateCaseField(raw.input_files, vars, filters) }
      : {}),
    ...(raw.expected_output !== undefined
      ? { expected_output: interpolateCaseField(raw.expected_output, vars, filters) }
      : {}),
    ...(raw.assert !== undefined
      ? { assert: interpolateCaseField(raw.assert, vars, filters) }
      : {}),
    ...(raw.turns !== undefined ? { turns: interpolateCaseTurns(raw.turns, vars, filters) } : {}),
  };
}

function shouldExpandVarValue(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value) && (value.length === 0 || typeof value[0] === 'string');
}

function expandArrayVarCases(raw: RawEvalCase): readonly RawEvalCase[] {
  if (!isJsonObject(raw.vars)) {
    return [raw];
  }

  const entries = Object.entries(raw.vars);
  let combinations: Record<string, JsonValue>[] = [{}];
  let expanded = false;

  for (const [key, value] of entries) {
    const values = shouldExpandVarValue(value) ? value : [value];
    expanded ||= values.length !== 1 || values[0] !== value;
    const next: Record<string, JsonValue>[] = [];
    for (const combination of combinations) {
      for (const candidate of values) {
        next.push({ ...combination, [key]: candidate });
      }
    }
    combinations = next;
  }

  if (!expanded) {
    return [raw];
  }

  return combinations.map((vars) => ({ ...raw, vars }));
}

function stablePromptId(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function stableScenarioTestId(
  scenarioIndex: number,
  configIndex: number,
  testIndex: number,
): string {
  return `scenario-${scenarioIndex + 1}-${configIndex + 1}-${testIndex + 1}`;
}

function safePromptId(value: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe.length > 0 ? safe.slice(0, 48) : stablePromptId(value);
}

function stripFileProtocol(value: string): string {
  return value.startsWith('file://') ? value.slice('file://'.length) : value;
}

const REF_PROTOCOL = 'ref://';

function expandNamedReference(rawValue: string, refs?: ReferenceMap): string {
  const trimmed = rawValue.trim();
  if (!trimmed.startsWith(REF_PROTOCOL)) {
    return trimmed;
  }

  const name = trimmed.slice(REF_PROTOCOL.length).trim();
  if (name.length === 0) {
    throw new Error(`Invalid ref reference '${rawValue}'. Use ref://name.`);
  }
  const value = refs?.[name];
  if (!value) {
    throw new Error(`Unknown ref '${name}' in default_test. Define refs.${name} in config.yaml.`);
  }
  return value.trim();
}

type DefaultTestResolution = {
  readonly value: JsonValue | undefined;
  readonly references: readonly EvalSourceReference[];
};

async function loadDefaultTestFile(
  rawReference: string,
  displayReference: string,
  searchRoots: readonly string[],
  refs: ReferenceMap | undefined,
  env: ReturnType<typeof createEvalConfigEnv>,
): Promise<DefaultTestResolution> {
  const expandedReference = expandNamedReference(rawReference, refs);
  if (!expandedReference.startsWith('file://')) {
    throw new Error(
      `Invalid default_test reference '${rawReference}'. Use file://... or ref://name that resolves to file://... .`,
    );
  }

  const fileReference = stripFileProtocol(expandedReference);
  const { displayPath, resolvedPath, attempted } = await resolveFileReference(
    fileReference,
    searchRoots,
  );
  if (!resolvedPath) {
    const attempts = attempted.length
      ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
      : undefined;
    logError(`default_test file not found: ${displayPath}`, attempts);
    throw new Error(`default_test file not found: ${displayPath}`);
  }

  const loaded = interpolateEnv(parseYamlValue(await readFile(resolvedPath, 'utf8')), env);
  if (!isJsonObject(loaded)) {
    throw new Error(`default_test file must contain a YAML object: ${displayPath}`);
  }
  if (loaded.description !== undefined) {
    throw new Error(`default_test file must not define description: ${displayPath}`);
  }
  if (loaded.assertions !== undefined) {
    throw new Error(`default_test file must use assert, not assertions: ${displayPath}`);
  }
  return {
    value: loaded,
    references: [
      {
        kind: 'default_test',
        displayPath: displayReference,
        resolvedPath,
      },
    ],
  };
}

async function resolveDefaultTestValue(
  rawDefaultTest: JsonValue | undefined,
  displayReference: string | undefined,
  searchRoots: readonly string[],
  refs: ReferenceMap | undefined,
  env: ReturnType<typeof createEvalConfigEnv>,
): Promise<DefaultTestResolution> {
  if (typeof rawDefaultTest === 'string') {
    return loadDefaultTestFile(
      rawDefaultTest,
      displayReference ?? rawDefaultTest,
      searchRoots,
      refs,
      env,
    );
  }
  return { value: rawDefaultTest, references: [] };
}

function combineInheritedAssertions(
  defaultTest: JsonValue | undefined,
  suiteAssert: JsonValue | undefined,
): JsonValue | undefined {
  const defaultAssert = isJsonObject(defaultTest) ? defaultTest.assert : undefined;
  const parts: JsonValue[] = [];

  for (const value of [defaultAssert, suiteAssert]) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      parts.push(...value);
    } else {
      parts.push(value);
    }
  }

  return parts.length > 0 ? parts : undefined;
}

function readDefaultTestVars(defaultTest: JsonValue | undefined): JsonObject | undefined {
  if (!isJsonObject(defaultTest) || !isJsonObject(defaultTest.vars)) {
    return undefined;
  }
  return defaultTest.vars;
}

function mergeDefaultTestVarsIntoCases(
  rawCases: readonly JsonValue[],
  defaultTest: JsonValue | undefined,
): readonly JsonValue[] {
  const defaultVars = readDefaultTestVars(defaultTest);
  if (!defaultVars || Object.keys(defaultVars).length === 0) {
    return rawCases;
  }

  return rawCases.map((rawCase) => {
    if (!isJsonObject(rawCase)) {
      return rawCase;
    }
    if (rawCase.vars !== undefined && !isJsonObject(rawCase.vars)) {
      return rawCase;
    }
    const caseVars = isJsonObject(rawCase.vars) ? rawCase.vars : {};
    return {
      ...rawCase,
      vars: {
        ...defaultVars,
        ...caseVars,
      },
    };
  });
}

function readDefaultTestOptions(defaultTest: JsonValue | undefined): JsonObject | undefined {
  if (!isJsonObject(defaultTest) || !isJsonObject(defaultTest.options)) {
    return undefined;
  }
  return defaultTest.options;
}

function mergeDefaultTestOptionsIntoCases(
  rawCases: readonly JsonValue[],
  defaultTest: JsonValue | undefined,
): readonly JsonValue[] {
  const defaultOptions = readDefaultTestOptions(defaultTest);
  if (!defaultOptions || Object.keys(defaultOptions).length === 0) {
    return rawCases;
  }

  return rawCases.map((rawCase) => {
    if (!isJsonObject(rawCase)) {
      return rawCase;
    }
    if (rawCase.options !== undefined && !isJsonObject(rawCase.options)) {
      return rawCase;
    }
    const caseOptions = isJsonObject(rawCase.options) ? rawCase.options : {};
    return {
      ...rawCase,
      options: {
        ...defaultOptions,
        ...caseOptions,
      },
    };
  });
}

function rejectPostprocess(value: unknown, location: string): void {
  if (!isJsonObject(value)) {
    return;
  }
  if (value.postprocess !== undefined) {
    throw new Error(`${location}.postprocess has been removed. Use ${location}.transform instead.`);
  }
}

function rejectPreprocessors(value: unknown, location: string): void {
  if (!isJsonObject(value)) {
    return;
  }
  if (value.preprocessors !== undefined) {
    throw new Error(
      `${location}.preprocessors has been removed from authored eval YAML. Use ${location}.transform instead.`,
    );
  }
}

function rejectAuthoredPostprocess(suite: RawTestSuite): void {
  rejectPostprocess(
    isJsonObject(suite.default_test) ? suite.default_test.options : undefined,
    'default_test.options',
  );
  if (Array.isArray(suite.assert)) {
    suite.assert.forEach((entry, index) => {
      rejectPostprocess(entry, `assert[${index}]`);
      rejectPreprocessors(entry, `assert[${index}]`);
    });
  }
  if (suite.preprocessors !== undefined) {
    throw new Error(
      'preprocessors has been removed from authored eval YAML. Use default_test.options.transform or assertion-level transform instead.',
    );
  }
  if (!Array.isArray(suite.tests)) {
    return;
  }
  suite.tests.forEach((entry, index) => {
    if (!isJsonObject(entry)) {
      return;
    }
    rejectPostprocess(entry.options, `tests[${index}].options`);
    if (Array.isArray(entry.assert)) {
      entry.assert.forEach((assertion, assertionIndex) => {
        rejectPostprocess(assertion, `tests[${index}].assert[${assertionIndex}]`);
        rejectPreprocessors(assertion, `tests[${index}].assert[${assertionIndex}]`);
      });
    }
  });
}

function rejectTopLevelImports(suite: JsonObject): void {
  if (suite.imports !== undefined) {
    throw new Error(
      "Top-level 'imports' is not supported. Run eval files directly with CLI multi-file selection and tags for grouping. For raw case files, use tests: file://... or string entries under tests. For reusable scenarios, use scenarios: [file://...]. For reusable config, use prompts: file://..., default_test: file://..., and environment: file://... for coding-agent testbeds.",
    );
  }
}

function isChatPromptArray(value: readonly JsonValue[]): boolean {
  return value.length > 0 && value.every((entry) => isJsonObject(entry) && isTestMessage(entry));
}

async function readPromptFile(
  rawPath: string,
  searchRoots: readonly string[],
): Promise<{
  readonly displayPath: string;
  readonly text: string;
}> {
  const filePath = stripFileProtocol(rawPath);
  const { displayPath, resolvedPath, attempted } = await resolveFileReference(
    filePath,
    searchRoots,
  );
  if (!resolvedPath) {
    const attempts = attempted.length
      ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
      : undefined;
    logError(`Prompt file not found: ${displayPath}`, attempts);
    throw new Error(`Prompt file not found: ${displayPath}`);
  }
  return {
    displayPath,
    text: (await readFile(resolvedPath, 'utf8')).replace(/\r\n/g, '\n'),
  };
}

function promptSourceInputFromStdout(stdout: string, index: number): JsonValue {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`Invalid prompts[${index}] function source: command produced empty output.`);
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (typeof parsed === 'string' || (Array.isArray(parsed) && isChatPromptArray(parsed))) {
      return parsed;
    }
    if (isJsonObject(parsed)) {
      if (typeof parsed.prompt === 'string') {
        return parsed.prompt;
      }
      if (typeof parsed.raw === 'string') {
        return parsed.raw;
      }
      if (Array.isArray(parsed.messages) && isChatPromptArray(parsed.messages)) {
        return parsed.messages;
      }
    }
  } catch {
    return trimmed;
  }

  throw new Error(
    `Invalid prompts[${index}] function source output: expected text or chat messages.`,
  );
}

async function resolvePromptCommand(
  command: readonly string[],
  searchRoots: readonly string[],
): Promise<readonly string[]> {
  const last = command.at(-1);
  if (!last) {
    return command;
  }

  const resolved = await resolveFileReference(last, searchRoots);
  return resolved.resolvedPath
    ? [...command.slice(0, -1), path.resolve(resolved.resolvedPath)]
    : command;
}

async function executePromptSource(
  command: readonly string[],
  searchRoots: readonly string[],
  index: number,
): Promise<JsonValue> {
  const resolvedCommand = await resolvePromptCommand(command, searchRoots);
  const cwd = searchRoots[0] ? path.resolve(searchRoots[0]) : undefined;
  try {
    const stdout = await executeScript(resolvedCommand, '', undefined, cwd);
    return promptSourceInputFromStdout(stdout, index);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Prompt function source failed for prompts[${index}]: ${message}`);
  }
}

async function executePromptFunctionFile(
  rawPath: string,
  searchRoots: readonly string[],
  index: number,
): Promise<{ readonly displayPath: string; readonly input: JsonValue }> {
  const filePath = stripFileProtocol(rawPath);
  const { displayPath, resolvedPath, attempted } = await resolveFileReference(
    filePath,
    searchRoots,
  );
  if (!resolvedPath) {
    const attempts = attempted.length
      ? ['  Tried:', ...attempted.map((candidate) => `    ${candidate}`)]
      : undefined;
    logError(`Prompt function file not found: ${displayPath}`, attempts);
    throw new Error(`Prompt function file not found: ${displayPath}`);
  }

  return {
    displayPath,
    input: await executePromptSource(
      [process.execPath, path.resolve(resolvedPath)],
      searchRoots,
      index,
    ),
  };
}

async function parsePromptDefinition(
  rawPrompt: JsonValue,
  searchRoots: readonly string[],
  index: number,
): Promise<PromptDefinition> {
  if (typeof rawPrompt === 'string') {
    if (rawPrompt.startsWith('file://')) {
      const { displayPath, text } = await readPromptFile(rawPrompt, searchRoots);
      return {
        identity: { id: displayPath, label: displayPath, kind: 'file' },
        input: text,
      };
    }
    return {
      identity: { id: `prompt-${stablePromptId(rawPrompt)}`, kind: 'string' },
      input: rawPrompt,
    };
  }

  if (Array.isArray(rawPrompt)) {
    if (!isChatPromptArray(rawPrompt)) {
      throw new Error(
        'Invalid prompts entry: arrays must be chat messages or a top-level list of prompt entries.',
      );
    }
    return {
      identity: { id: `chat-${stablePromptId(rawPrompt)}`, kind: 'chat' },
      input: rawPrompt,
    };
  }

  if (!isJsonObject(rawPrompt)) {
    throw new Error(`Invalid prompts[${index}]: expected string, chat array, or object.`);
  }

  const label = asString(rawPrompt.label)?.trim();
  const explicitId = asString(rawPrompt.id)?.trim();

  if (rawPrompt.function_file !== undefined) {
    const functionFile = asString(rawPrompt.function_file);
    if (!functionFile) {
      throw new Error(`Invalid prompts[${index}].function_file: expected non-empty string.`);
    }
    const { displayPath, input } = await executePromptFunctionFile(
      functionFile,
      searchRoots,
      index,
    );
    return {
      identity: {
        id: explicitId ?? displayPath,
        ...(label ? { label } : { label: displayPath }),
        kind: 'function',
      },
      input,
    };
  }

  if (rawPrompt.function !== undefined) {
    const functionSource = asString(rawPrompt.function);
    if (!functionSource) {
      throw new Error(`Invalid prompts[${index}].function: expected non-empty string path.`);
    }
    const { displayPath, input } = await executePromptFunctionFile(
      functionSource,
      searchRoots,
      index,
    );
    return {
      identity: {
        id: explicitId ?? displayPath,
        ...(label ? { label } : { label: displayPath }),
        kind: 'function',
      },
      input,
    };
  }

  if (rawPrompt.command !== undefined) {
    const command = parseCommandArray(rawPrompt.command);
    if (!command) {
      throw new Error(`Invalid prompts[${index}].command: expected command string or array.`);
    }
    return {
      identity: {
        id: explicitId ?? `function-${stablePromptId(command)}`,
        ...(label ? { label } : {}),
        kind: 'function',
      },
      input: await executePromptSource(command, searchRoots, index),
    };
  }

  if (rawPrompt.file !== undefined) {
    const fileRef = asString(rawPrompt.file);
    if (!fileRef) {
      throw new Error(`Invalid prompts[${index}].file: expected non-empty string.`);
    }
    const { displayPath, text } = await readPromptFile(fileRef, searchRoots);
    return {
      identity: {
        id: explicitId ?? displayPath,
        ...(label ? { label } : { label: displayPath }),
        kind: 'file',
      },
      input: text,
    };
  }

  if (rawPrompt.messages !== undefined) {
    if (!Array.isArray(rawPrompt.messages) || !isChatPromptArray(rawPrompt.messages)) {
      throw new Error(`Invalid prompts[${index}].messages: expected chat message array.`);
    }
    return {
      identity: {
        id: explicitId ?? `chat-${stablePromptId(rawPrompt.messages)}`,
        ...(label ? { label } : {}),
        kind: 'chat',
      },
      input: rawPrompt.messages,
    };
  }

  if (rawPrompt.prompt !== undefined) {
    const promptValue = rawPrompt.prompt;
    if (
      typeof promptValue !== 'string' &&
      !(Array.isArray(promptValue) && isChatPromptArray(promptValue))
    ) {
      throw new Error(`Invalid prompts[${index}].prompt: expected string or chat message array.`);
    }
    const kind = Array.isArray(promptValue) ? 'chat' : 'string';
    return {
      identity: {
        id: explicitId ?? `${kind}-${stablePromptId(promptValue)}`,
        ...(label ? { label } : {}),
        kind,
      },
      input: promptValue,
    };
  }

  if (rawPrompt.raw !== undefined) {
    const rawValue = asString(rawPrompt.raw);
    if (!rawValue) {
      throw new Error(`Invalid prompts[${index}].raw: expected non-empty string.`);
    }
    return {
      identity: {
        id: explicitId ?? `string-${stablePromptId(rawValue)}`,
        ...(label ? { label } : {}),
        kind: 'string',
      },
      input: rawValue,
    };
  }

  if (isTestMessage(rawPrompt)) {
    return {
      identity: {
        id: explicitId ?? `chat-${stablePromptId(rawPrompt)}`,
        ...(label ? { label } : {}),
        kind: 'chat',
      },
      input: [rawPrompt],
    };
  }

  throw new Error(`Invalid prompts[${index}]: expected prompt, messages, file, or function.`);
}

async function parseSuitePrompts(
  rawPrompts: JsonValue | undefined,
  searchRoots: readonly string[],
): Promise<readonly PromptDefinition[] | undefined> {
  if (rawPrompts === undefined || rawPrompts === null) {
    return undefined;
  }

  const entries =
    Array.isArray(rawPrompts) && !isChatPromptArray(rawPrompts) ? rawPrompts : [rawPrompts];
  const prompts: PromptDefinition[] = [];
  for (let index = 0; index < entries.length; index++) {
    prompts.push(await parsePromptDefinition(entries[index] as JsonValue, searchRoots, index));
  }
  return prompts;
}

function renderPromptInput(prompt: PromptDefinition, vars: JsonObject | undefined): JsonValue {
  return interpolateCaseField(prompt.input, vars);
}

function expandPromptMatrix(
  rawCases: readonly JsonValue[],
  prompts: readonly PromptDefinition[] | undefined,
  suite: RawTestSuite,
): PromptExpansionResult {
  const promptById = new Map<string, EvalPromptIdentity>();
  const sourceTestIdById = new Map<string, string>();

  if (!prompts) {
    return { rawCases, promptById, sourceTestIdById };
  }

  if (suite.input !== undefined || suite.input_files !== undefined) {
    throw new Error("Top-level 'input' and 'input_files' cannot be combined with 'prompts'.");
  }

  const expandedCases: JsonValue[] = [];
  for (const rawCase of rawCases) {
    if (!isJsonObject(rawCase)) {
      expandedCases.push(rawCase);
      continue;
    }
    const promptCase: JsonObject =
      rawCase.input !== undefined
        ? (() => {
            const { input, input_files: _inputFiles, ...caseWithoutInput } = rawCase;
            return {
              ...caseWithoutInput,
              vars: {
                ...(isJsonObject(rawCase.vars) ? rawCase.vars : {}),
                input,
              },
            };
          })()
        : rawCase;

    const sourceTestId = asString(promptCase.id);
    const vars = isJsonObject(promptCase.vars) ? promptCase.vars : undefined;
    for (const prompt of prompts) {
      const promptId = safePromptId(prompt.identity.id);
      const expandedId =
        sourceTestId && prompts.length > 1 ? `${sourceTestId}__prompt_${promptId}` : sourceTestId;
      const expandedDependsOn = Array.isArray(promptCase.depends_on)
        ? promptCase.depends_on.map((dep) =>
            typeof dep === 'string' && prompts.length > 1 ? `${dep}__prompt_${promptId}` : dep,
          )
        : promptCase.depends_on;
      const expandedCase: JsonObject = {
        ...promptCase,
        ...(expandedId ? { id: expandedId } : {}),
        ...(expandedDependsOn !== undefined ? { depends_on: expandedDependsOn } : {}),
        input: renderPromptInput(prompt, vars),
      };
      expandedCases.push(expandedCase);
      if (expandedId) {
        promptById.set(expandedId, prompt.identity);
        if (sourceTestId) {
          sourceTestIdById.set(expandedId, sourceTestId);
        }
      }
    }
  }

  return { rawCases: expandedCases, promptById, sourceTestIdById };
}

async function loadNunjucksFilters(
  rawFilters: JsonValue | undefined,
  evalFileDir: string,
): Promise<NunjucksFilterMap | undefined> {
  if (rawFilters === undefined) {
    return undefined;
  }
  if (!isJsonObject(rawFilters)) {
    logWarning('Invalid nunjucks_filters: expected object mapping filter names to file paths');
    return undefined;
  }

  const filters: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [name, rawFilterPath] of Object.entries(rawFilters)) {
    if (typeof rawFilterPath !== 'string' || rawFilterPath.trim().length === 0) {
      logWarning(`Skipping nunjucks filter '${name}': expected file path string`);
      continue;
    }

    const filterPath = rawFilterPath.startsWith('file://')
      ? rawFilterPath.slice('file://'.length)
      : rawFilterPath;
    const matches = await fg(path.resolve(evalFileDir, filterPath).replaceAll('\\', '/'), {
      onlyFiles: true,
      absolute: true,
    });
    const resolvedPath = matches.sort().at(-1) ?? path.resolve(evalFileDir, filterPath);
    const imported = (await import(pathToFileURL(resolvedPath).href)) as Record<string, unknown>;
    const filter = imported.default ?? imported[name];
    if (typeof filter !== 'function') {
      throw new Error(
        `Invalid nunjucks filter '${name}' at ${resolvedPath}: expected default export or named export '${name}' to be a function`,
      );
    }
    filters[name] = filter as (...args: unknown[]) => unknown;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

/**
 * Read metadata from a test suite file (like target name).
 * This is a convenience function for CLI tools that need metadata without loading all tests.
 */
export async function readTestSuiteMetadata(testFilePath: string): Promise<{
  target?: string;
  targetSpec?: EvalTargetSpec;
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
      targetSpec: parseEvalTargetSpec((parsed as RawTestSuite).target),
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
  /** Runtime target list from CLI/project config, not authored eval YAML. */
  readonly targets?: readonly string[];
  /** Runtime target refs with hooks from CLI/project config, not authored eval YAML. */
  readonly targetRefs?: readonly import('./types.js').EvalTargetRef[];
  /** Single authored target string or eval-local overlay object. */
  readonly targetSpec?: EvalTargetSpec;
  /** Suite-level concurrency from evaluate_options.max_concurrency. */
  readonly workers?: number;
  /** Suite-level cache config from project/CLI runtime surfaces. */
  readonly cacheConfig?: import('./loaders/config-loader.js').CacheConfig;
  /** Suite-level metadata (name, description, version, etc.) */
  readonly metadata?: import('./metadata.js').EvalMetadata;
  /**
   * Promptfoo-shaped suite tags map (`Record<string,string>`) when `tags:` is
   * authored as a map rather than a selection list. The reserved key
   * `experiment` feeds the experiment namespace; the full map is carried as run
   * metadata. Absent when `tags:` is a string/list (that form drives selection
   * via `metadata.tags`).
   */
  readonly tags?: Record<string, string>;
  /** Suite-level total cost budget in USD */
  readonly budgetUsd?: number;
  /** Execution error tolerance from project/CLI runtime surfaces. */
  readonly failOnError?: import('./types.js').FailOnError;
  /** Suite-level quality threshold (0-1) — suite fails if mean score is below */
  readonly threshold?: number;
  /** Preferred inherited per-test defaults from default_test. */
  readonly defaultTest?: EvalDefaultTestDefaults;
  /** Eval-authored default provider selections from top-level defaults. */
  readonly defaults?: ConfigDefaults;
  /** Internal normalized run controls derived from flat eval YAML. */
  readonly experimentConfig?: ExperimentConfig;
  /** Inline target definition from a TS eval config. */
  readonly inlineTarget?: import('./providers/types.js').ProviderDefinition;
  /** Custom provider factory from a TS eval config task(). */
  readonly providerFactory?: import('./providers/provider-registry.js').ProviderFactoryFn;
};

export type EvalDefaultTestDefaults = {
  readonly threshold?: number;
  readonly rubricPrompt?: JsonValue;
};

export type EvalTargetSpec = {
  readonly name: string;
  readonly extends?: string;
  readonly definition?: ProviderDefinition;
  readonly hooks?: TargetHooksConfig;
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
  if (format === 'typescript') {
    const { loadTsEvalSuite } = await import('./loaders/ts-eval-loader.js');
    return loadTsEvalSuite(evalFilePath, resolveToAbsolutePath(repoRoot), options);
  }
  const { tests, parsed } = await loadTestsFromYaml(evalFilePath, repoRoot, options);
  return buildEvalSuiteResult(parsed, tests, options);
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

  return buildEvalSuiteResult(parsed, tests, options);
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
  const configEnv = createEvalConfigEnv(repoRootPath);

  // Load configuration (walks up directory tree to repo root)
  const config = await loadConfig(absoluteTestPath, repoRootPath);

  const rawCaseSnapshots = buildRawInlineTestSnapshots(rawParsed);
  const interpolated = interpolateEnv(rawParsed, configEnv) as unknown;
  if (!isJsonObject(interpolated)) {
    throw new Error(`Invalid test file format: ${evalFilePath}`);
  }
  rejectAuthoredWorkers(interpolated);
  rejectAuthoredDirectInput(interpolated);
  rejectTargetTestbedFields(interpolated);
  if (options?.allowInternalExpectedOutput !== true) {
    rejectAuthoredExpectedOutput(interpolated);
  }
  rejectAuthoredProviderOutput(interpolated);

  const rawSuite = rawParsed as RawTestSuite;
  const resolvedDefaultTest = await resolveDefaultTestValue(
    (interpolated as RawTestSuite).default_test,
    typeof rawSuite.default_test === 'string' ? rawSuite.default_test : undefined,
    searchRoots,
    config?.refs,
    configEnv,
  );
  const suite = {
    ...(interpolated as RawTestSuite),
    default_test: resolvedDefaultTest.value,
  } as RawTestSuite;
  rejectTopLevelImports(suite);
  rejectAuthoredPostprocess(suite);
  const defaultTestReferences = resolvedDefaultTest.references;
  const suiteNameFromFile = asString(suite.name)?.trim();
  const fallbackSuiteName =
    path
      .basename(absoluteTestPath)
      .replace(/\.eval\.ya?ml$/i, '')
      .replace(/\.ya?ml$/i, '') || 'eval';
  const suiteName =
    suiteNameFromFile && suiteNameFromFile.length > 0 ? suiteNameFromFile : fallbackSuiteName;

  const rawTestCases = resolveTests(suite, evalFilePath);
  const suiteExperimentConfig = normalizeSuiteExperimentConfig(suite);
  // Top-level `metadata:` is inherited by cases. Suite identity tags are parsed
  // separately by parseMetadata() and are not case tags.
  const suiteMetadataPayload = extractSuiteMetadataPayload(suite);
  const evalFileDir = path.dirname(absoluteTestPath);

  const globalEvaluator = coerceEvaluator(suite.evaluator, 'global');
  const defaultTestRubricPrompt = extractDefaultTestRubricPrompt(suite);
  const suiteExtensions = parseExtensions(suite.extensions, evalFileDir);
  const suiteEnvironment = await resolveEnvironmentRecipe(
    suite.environment,
    evalFileDir,
    'environment',
  );

  const importedSuiteTests: EvalTest[] = [];
  const nunjucksFilters = await loadNunjucksFilters(suite.nunjucks_filters, evalFileDir);
  const parentWorkspace = parentWorkspaceLocation(suite);
  const parentEnvironment = parentEnvironmentLocation(suite);
  // Resolve tests: string path to external file/directory, inline array, legacy include entries, or error.
  let expandedTestCases: readonly JsonValue[];
  if (typeof rawTestCases === 'string') {
    expandedTestCases = await loadRawCasesFromShorthand(rawTestCases, evalFileDir);
  } else if (Array.isArray(rawTestCases)) {
    const expanded = await expandInlineTestEntries({
      entries: rawTestCases,
      evalFileDir,
      repoRoot,
      suiteMetadataPayload,
      parentWorkspaceLocation: parentWorkspace,
      parentEnvironmentLocation: parentEnvironment,
      options,
    });
    expandedTestCases = expanded.rawCases;
    importedSuiteTests.push(...expanded.importedSuiteTests);
  } else if (suite.scenarios !== undefined) {
    expandedTestCases = [];
  } else {
    throw new Error(`Invalid test file format: ${evalFilePath} - missing 'tests' field`);
  }

  const expandedScenarios = Array.isArray(suite.scenarios)
    ? await expandScenarioReferences(suite.scenarios, evalFileDir)
    : suite.scenarios;
  const scenarioSuite =
    expandedScenarios === undefined
      ? suite
      : ({ ...suite, scenarios: expandedScenarios } as RawTestSuite);
  const scenarioTestCases = lowerScenariosIntoTests(scenarioSuite, evalFilePath);
  if (scenarioTestCases.length > 0) {
    expandedTestCases = [...expandedTestCases, ...scenarioTestCases];
  }

  expandedTestCases = mergeDefaultTestVarsIntoCases(expandedTestCases, suite.default_test);
  expandedTestCases = mergeDefaultTestOptionsIntoCases(expandedTestCases, suite.default_test);

  const promptDefinitions = await parseSuitePrompts(suite.prompts, searchRoots);
  const promptExpansion = expandPromptMatrix(expandedTestCases, promptDefinitions, suite);
  expandedTestCases = promptExpansion.rawCases;

  const suiteWorkspace = await resolveWorkspaceConfig(suite.workspace, evalFileDir);

  const rawSuiteInput = suite.input;
  const rawSuiteInputFiles = suite.input_files;

  readSuiteRuntimeBlock(suite, evalFilePath);

  // Build global execution context, including suite-level assert entries (which are siblings of execution)
  const suiteAssertions = combineInheritedAssertions(suite.default_test, suite.assert);
  const globalExecution: JsonObject | undefined =
    suiteAssertions !== undefined ? { assert: suiteAssertions } : undefined;

  const results: EvalTest[] = [];

  for (const rawExpandedTestCase of expandedTestCases) {
    const expandedVarCases = isJsonObject(rawExpandedTestCase)
      ? expandArrayVarCases(rawExpandedTestCase as RawEvalCase)
      : [rawExpandedTestCase];

    for (const rawTestCase of expandedVarCases) {
      if (!isJsonObject(rawTestCase)) {
        logWarning('Skipping invalid test entry (expected object)');
        continue;
      }

      const testCaseConfig = rawTestCase as RawEvalCase;
      const caseVars = isJsonObject(testCaseConfig.vars) ? testCaseConfig.vars : undefined;
      const renderedCase = interpolateRawEvalCase(testCaseConfig, caseVars, nunjucksFilters);
      const id = asString(renderedCase.id);
      const promptIdentity = id ? promptExpansion.promptById.get(id) : undefined;
      const sourceTestId = id ? promptExpansion.sourceTestIdById.get(id) : undefined;

      // Skip tests that don't match the filter pattern (glob supported)
      if (filterPattern && (!id || !matchesFilter(id, filterPattern))) {
        continue;
      }

      const conversationId = asString(renderedCase.conversation_id);
      let outcome = asString(renderedCase.criteria);
      if (!outcome && renderedCase.expected_outcome !== undefined) {
        outcome = asString(renderedCase.expected_outcome);
        if (outcome) {
          logWarning(
            `Test '${asString(renderedCase.id) ?? 'unknown'}': 'expected_outcome' has been removed. Use 'assert' instead.`,
          );
        }
      }

      // Extract per-case execution config early (reused below for skip_defaults)
      const caseExecution = isJsonObject(renderedCase.execution)
        ? renderedCase.execution
        : undefined;
      rejectUnsupportedTestExecutionFields(caseExecution, id);
      if (caseExecution?.workspace !== undefined) {
        throw new Error(
          `test '${id ?? 'unknown'}'.execution.workspace has been removed from eval YAML. Put machine-local workspace_path in .agentv/config.local.yaml under execution, or pass --workspace-path. Keep portable task setup in test workspace or suite workspace.`,
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
        mergeRunOverrides(
          caseThreshold !== undefined ? { threshold: caseThreshold } : undefined,
          normalizeRunOverride(renderedCase.run, `test '${id ?? 'unknown'}'.run`),
        ),
        normalizeOptionsRepeatOverride(
          renderedCase.options,
          `test '${id ?? 'unknown'}'.options.repeat`,
        ),
      );

      // Resolve input with shorthand support (pass suite-level input_files for merge)
      const effectiveSuiteInputFiles =
        rawSuiteInputFiles && !skipDefaults
          ? interpolateCaseField(rawSuiteInputFiles, caseVars, nunjucksFilters)
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
      const testInputMessages = resolveInputMessages(inputCase, inputSuiteFiles) ?? [];
      // Resolve expected_output with shorthand support
      const expectedMessages = resolveExpectedMessages(renderedCase) ?? [];
      const effectiveSuiteInputValue =
        rawSuiteInput && !skipDefaults
          ? interpolateCaseField(rawSuiteInput, caseVars, nunjucksFilters)
          : undefined;
      const effectiveSuiteInputMessages = expandInputShorthand(effectiveSuiteInputValue);

      const hasExplicitCaseGraders = renderedCase.assert !== undefined;
      const hasExplicitRootGraders =
        skipDefaults === true ? false : globalExecution?.assert !== undefined;
      const graderCase =
        outcome && !hasExplicitCaseGraders && !hasExplicitRootGraders
          ? ({ ...renderedCase, assert: [outcome] } satisfies RawEvalCase)
          : renderedCase;

      // A test is complete when it has id, input, and at least one of: criteria,
      // expected_output, assert, or turns (conversation mode). Legacy test-level
      // criteria is desugared to a bare-string assert above so it uses the canonical
      // llm-rubric path instead of the implicit default LLM grader.
      const hasEvaluationSpec =
        !!outcome ||
        expectedMessages.length > 0 ||
        graderCase.assert !== undefined ||
        hasExplicitRootGraders ||
        (Array.isArray(renderedCase.turns) && renderedCase.turns.length > 0);
      const hasInputMessages =
        testInputMessages.length > 0 ||
        (effectiveSuiteInputMessages !== undefined && effectiveSuiteInputMessages.length > 0);
      if (!id || !hasEvaluationSpec || !hasInputMessages) {
        logError(
          `Skipping incomplete test: ${id ?? 'unknown'}. Missing required fields: id, input or PROMPT.md, and at least one of criteria/expected_output/assert/turns`,
        );
        continue;
      }

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
          graderCase,
          globalExecution,
          searchRoots,
          id ?? 'unknown',
          undefined,
          defaultTestRubricPrompt,
        );
      } catch (error) {
        // Skip entire test if evaluator validation fails
        const message = error instanceof Error ? error.message : String(error);
        logError(`Skipping test '${id}': ${message}`);
        continue;
      }

      const assertionTemplateReferences = await collectAssertionTemplateSourceReferences(
        graderCase,
        globalExecution,
        searchRoots,
        id ?? 'unknown',
      );

      warnUnconsumedCriteria(outcome, evaluators, id ?? 'unknown');

      const userFilePaths = collectResolvedInputFilePaths(inputMessages);

      // Parse per-case workspace config and merge with suite-level
      const caseWorkspace = await resolveWorkspaceConfig(renderedCase.workspace, evalFileDir);
      const mergedWorkspace = mergeWorkspaceConfigs(suiteWorkspace, caseWorkspace);
      const caseEnvironment = await resolveEnvironmentRecipe(
        renderedCase.environment,
        evalFileDir,
        `test '${id ?? 'unknown'}'.environment`,
      );
      const environment = caseEnvironment ?? suiteEnvironment;

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
        onTurnFailureRaw === 'continue' || onTurnFailureRaw === 'stop'
          ? onTurnFailureRaw
          : undefined;
      const windowSize =
        typeof renderedCase.window_size === 'number' && renderedCase.window_size >= 1
          ? (renderedCase.window_size as number)
          : undefined;

      const category = normalizeCategoryPath(suite.category ?? options?.category);
      const renderedOptions = isJsonObject(renderedCase.options) ? renderedCase.options : undefined;
      const outputTransform = await parseTransformSpec(
        renderedOptions?.transform as JsonValue | undefined,
        searchRoots,
        `test '${id ?? 'unknown'}'.options`,
      );

      const testCase: EvalTest = {
        id,
        ...(sourceTestId ? { testId: sourceTestId } : {}),
        suite: suiteName,
        category,
        conversation_id: conversationId,
        ...(typeof renderedCase.description === 'string'
          ? { description: renderedCase.description }
          : {}),
        ...(promptIdentity ? { prompt: promptIdentity } : {}),
        question: question,
        input: inputMessages,
        expected_output: outputSegments,
        reference_answer: referenceAnswer,
        file_paths: userFilePaths,
        criteria: outcome ?? '',
        evaluator: testCaseEvaluatorKind,
        assertions: evaluators,
        ...(caseVars ? { vars: caseVars } : {}),
        ...(outputTransform ? { outputTransform } : {}),
        ...(suiteExtensions.length > 0 ? { extensions: suiteExtensions } : {}),
        ...(environment ? { environment } : {}),
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
          defaultTestReferences,
        }),
      };

      results.push(testCase);
    }
  }

  return {
    tests: [...importedSuiteTests, ...results],
    parsed: suite,
  };
}

function buildEvalSuiteResult(
  parsed: JsonObject,
  tests: readonly EvalTest[],
  options?: LoadOptions,
): EvalSuiteResult {
  rejectAuthoredWorkers(parsed);
  if (options?.allowInternalExpectedOutput !== true) {
    rejectAuthoredExpectedOutput(parsed);
  }
  rejectAuthoredProviderOutput(parsed);
  const metadata = parseMetadata(parsed);
  const failOnError = extractFailOnError(parsed);
  const threshold = extractThreshold(parsed);
  const defaultTestThreshold = extractDefaultTestThreshold(parsed);
  const defaultTestRubricPrompt = extractDefaultTestRubricPrompt(parsed);
  const defaultTest =
    defaultTestThreshold !== undefined || defaultTestRubricPrompt !== undefined
      ? {
          ...(defaultTestThreshold !== undefined ? { threshold: defaultTestThreshold } : {}),
          ...(defaultTestRubricPrompt !== undefined
            ? { rubricPrompt: defaultTestRubricPrompt }
            : {}),
        }
      : undefined;
  const experimentConfig = normalizeSuiteExperimentConfig(parsed);
  const tags = extractSuiteTagMap(parsed);
  const defaults = extractSuiteDefaults(parsed);

  return {
    tests,
    targets: extractTargetsFromSuite(parsed),
    targetRefs: extractTargetRefsFromSuite(parsed),
    targetSpec: parseEvalTargetSpec((parsed as RawTestSuite).target),
    workers: extractWorkersFromSuite(parsed),
    cacheConfig: extractCacheConfig(parsed),
    budgetUsd: extractBudgetUsd(parsed),
    ...(metadata !== undefined && { metadata }),
    ...(failOnError !== undefined && { failOnError }),
    ...(threshold !== undefined && { threshold }),
    ...(defaultTest !== undefined && { defaultTest }),
    ...(defaults !== undefined && { defaults }),
    ...(experimentConfig !== undefined && { experimentConfig }),
    ...(tags !== undefined && { tags }),
  };
}

function readOptionalDefaultSelection(value: unknown, location: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${location}: expected a non-empty string.`);
  }
  return value.trim();
}

function extractSuiteDefaults(parsed: JsonObject): ConfigDefaults | undefined {
  const rawDefaults = parsed.defaults;
  if (rawDefaults === undefined || rawDefaults === null) {
    return undefined;
  }
  if (!isJsonObject(rawDefaults)) {
    throw new Error('Invalid defaults: expected an object.');
  }
  if (rawDefaults.target !== undefined) {
    throw new Error(
      'Invalid defaults.target: defaults.target has been removed. Use defaults.provider.',
    );
  }
  const provider = readOptionalDefaultSelection(rawDefaults.provider, 'defaults.provider');
  const grader = readOptionalDefaultSelection(rawDefaults.grader, 'defaults.grader');
  if (!provider && !grader) {
    return undefined;
  }
  return {
    ...(provider ? { provider } : {}),
    ...(grader ? { grader } : {}),
  };
}

/**
 * Extract the promptfoo-shaped suite tags map when `tags:` (or `metadata.tags:`)
 * is authored as a `Record<string,string>`. The list/string form is a selection
 * construct and is intentionally ignored here (it flows through `metadata.tags`).
 * Top-level `tags:` wins over `metadata.tags` on key collisions.
 */
function extractSuiteTagMap(suite: JsonObject): Record<string, string> | undefined {
  const metadata = (suite as RawTestSuite).metadata;
  const metadataTags = isJsonObject(metadata) ? metadata.tags : undefined;
  const merged: Record<string, string> = {
    ...tagMapEntries(metadataTags),
    ...tagMapEntries((suite as RawTestSuite).tags),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function tagMapEntries(value: unknown): Record<string, string> {
  if (!isJsonObject(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      out[key] = entry;
    }
  }
  return out;
}

function rejectAuthoredWorkers(parsed: JsonObject): void {
  const locations: string[] = [];
  if (parsed.workers !== undefined) {
    locations.push('workers');
  }
  collectWorkersLocations(parsed.execution, 'execution', locations);
  collectWorkersLocations(parsed.experiment, 'experiment', locations);
  if (Array.isArray(parsed.tests)) {
    parsed.tests.forEach((entry, index) => {
      if (!isJsonObject(entry)) {
        return;
      }
      collectWorkersLocations(entry.execution, `tests[${index}].execution`, locations);
    });
  }

  if (locations.length === 0) {
    return;
  }

  throw new Error(
    `${locations[0]} has been removed from eval YAML. Set authored eval concurrency with evaluate_options.max_concurrency.`,
  );
}

function rejectAuthoredDirectInput(parsed: JsonObject): void {
  if (parsed.input !== undefined) {
    throw new Error(
      "Top-level 'input' has been removed from authored eval YAML. Author prompt text or chat messages in top-level 'prompts' and put shared data in default_test.vars or per-row data in tests[].vars.",
    );
  }

  if (!Array.isArray(parsed.tests)) {
    return;
  }

  for (let index = 0; index < parsed.tests.length; index++) {
    const entry = parsed.tests[index];
    if (!isJsonObject(entry) || entry.input === undefined) {
      continue;
    }
    throw new Error(
      `tests[${index}].input has been removed from authored eval YAML. Put prompt text or chat/system/user messages in top-level 'prompts' and put row-specific data in tests[].vars.`,
    );
  }
}

function rejectTargetTestbedFields(parsed: JsonObject): void {
  rejectSingleTargetTestbedFields((parsed as RawTestSuite).target, 'target');
  const rawTargets = (parsed as RawTestSuite).targets;
  const targets = Array.isArray(rawTargets)
    ? rawTargets
    : rawTargets === undefined
      ? []
      : [rawTargets];
  targets.forEach((target, index) => {
    rejectSingleTargetTestbedFields(target, `targets[${index}]`);
  });
}

function rejectSingleTargetTestbedFields(rawTarget: JsonValue | undefined, location: string): void {
  if (!isJsonObject(rawTarget)) {
    return;
  }
  if (rawTarget.environment !== undefined) {
    throw new Error(
      `${location}.environment is not supported. Author environment at suite/test/case scope, not under targets.`,
    );
  }
  if (rawTarget.container !== undefined) {
    throw new Error(
      `${location}.container is not supported. Use an environment recipe for testbed setup.`,
    );
  }
  if (rawTarget.install !== undefined) {
    throw new Error(`${location}.install is not supported. Use environment.setup.`);
  }
}

function rejectAuthoredExpectedOutput(parsed: JsonObject): void {
  if (parsed.expected_output !== undefined) {
    throw new Error(
      "Top-level 'expected_output' has been removed from authored eval YAML. Put reference answers in default_test.vars.expected_output or tests[].vars.expected_output and consume them with an explicit assertion such as { type: 'llm-rubric', value: 'Matches the reference answer: {{ expected_output }}' }.",
    );
  }

  if (isJsonObject(parsed.default_test) && parsed.default_test.expected_output !== undefined) {
    throw new Error(
      "default_test.expected_output has been removed from authored eval YAML. Put shared reference answers in default_test.vars.expected_output and consume them with an explicit assertion such as { type: 'llm-rubric', value: 'Matches the reference answer: {{ expected_output }}' }.",
    );
  }

  if (!Array.isArray(parsed.tests)) {
    return;
  }

  for (let index = 0; index < parsed.tests.length; index++) {
    const entry = parsed.tests[index];
    if (!isJsonObject(entry) || entry.expected_output === undefined) {
      continue;
    }
    throw new Error(
      `tests[${index}].expected_output has been removed from authored eval YAML. Put the reference answer in tests[].vars.expected_output and consume it with an explicit assertion such as { type: 'llm-rubric', value: 'Matches the reference answer: {{ expected_output }}' }.`,
    );
  }
}

function rejectAuthoredProviderOutput(parsed: JsonObject): void {
  if (isJsonObject(parsed.default_test) && parsed.default_test.provider_output !== undefined) {
    throw new Error(
      'default_test.provider_output is not supported in authored AgentV YAML. Use an explicit deterministic target such as provider: cli for fixed outputs, or use a replay/fixture target for captured provider responses.',
    );
  }

  if (!Array.isArray(parsed.tests)) {
    return;
  }

  for (let index = 0; index < parsed.tests.length; index++) {
    const entry = parsed.tests[index];
    if (!isJsonObject(entry) || entry.provider_output === undefined) {
      continue;
    }
    throw new Error(
      `tests[${index}].provider_output is not supported in authored AgentV YAML. Use an explicit deterministic target such as provider: cli for fixed outputs, or use a replay/fixture target for captured provider responses.`,
    );
  }
}

function collectWorkersLocations(raw: unknown, location: string, locations: string[]): void {
  if (!isJsonObject(raw)) {
    return;
  }
  if (raw.workers !== undefined) {
    locations.push(`${location}.workers`);
  }
  collectTargetWorkersLocations(raw.targets, `${location}.targets`, locations);
}

function collectTargetWorkersLocations(
  rawTargets: unknown,
  location: string,
  locations: string[],
): void {
  if (!Array.isArray(rawTargets)) {
    return;
  }
  rawTargets.forEach((target, index) => {
    if (isJsonObject(target) && target.workers !== undefined) {
      locations.push(`${location}[${index}].workers`);
    }
  });
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

function normalizeOptionsRepeatOverride(
  value: JsonValue | undefined,
  label: string,
): EvalRunOverride | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonObject(value)) {
    return undefined;
  }
  if (value.repeat === undefined) {
    return undefined;
  }
  return normalizeRunOverride({ repeat: value.repeat }, label);
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

function normalizeLegacyIncludeEntry(
  entry: JsonObject & { include: string },
): NormalizedImportEntry {
  const includePath = entry.include.trim();
  const mode = normalizeIncludeEntryType(entry.type, includePath);
  const select = readSelectPatterns(entry.select, `tests[].select for include '${includePath}'`);
  const includeRun = normalizeRunOverride(entry.run, `tests[].run for include '${includePath}'`);
  logWarning(
    mode === 'suite'
      ? `tests[].include with type: suite is deprecated. Run eval files directly instead: ${includePath}`
      : `tests[].include is deprecated. Use tests: file://... or a tests list file reference instead: ${includePath}`,
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
  readonly parentEnvironmentLocation?: string;
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
            `Parent workspace is not allowed with legacy tests[].include suite entries (${params.parentWorkspaceLocation}): ${entry.path}. Run eval files directly, or use tests: file://... for raw cases that should use the parent workspace.`,
          );
        }
        if (params.parentEnvironmentLocation) {
          throw new Error(
            `Parent environment is not allowed with legacy tests[].include suite entries (${params.parentEnvironmentLocation}): ${entry.path}. Run eval files directly, or use tests: file://... for raw cases that should use the parent environment.`,
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
  const normalizedPath = includePath.startsWith('file://')
    ? includePath.slice('file://'.length)
    : includePath;
  const absolutePattern = path.resolve(evalFileDir, normalizedPath);
  if (hasGlobMagic(normalizedPath)) {
    const matches = (await fg(absolutePattern.replaceAll('\\', '/'), {
      onlyFiles: true,
      absolute: true,
    })) as string[];
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
    const tests = resolveTests(raw as RawTestSuite, includePath);
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
  readonly parentEnvironmentLocation?: string;
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
      parentEnvironmentLocation: params.parentEnvironmentLocation,
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

  return undefined;
}

function parentEnvironmentLocation(suite: RawTestSuite): string | undefined {
  if (suite.environment !== undefined) {
    return 'environment';
  }

  return undefined;
}

function readSuiteRuntimeBlock(suite: RawTestSuite, evalFilePath: string): JsonObject | undefined {
  if (suite.experiment !== undefined && typeof suite.experiment !== 'string') {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'experiment' must be a string run/result grouping label.`,
    );
  }
  if (suite.policy !== undefined) {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'policy' is not part of eval YAML. Put repeat under evaluate_options.repeat, timeout_seconds and threshold at the top level, and budget_usd under evaluate_options.`,
    );
  }
  if (suite.execution !== undefined) {
    if (!isJsonObject(suite.execution)) {
      throw new Error(
        `Invalid eval runtime config in ${evalFilePath}: top-level 'execution' is not part of eval YAML. Use supported top-level fields or evaluate_options for authored run controls.`,
      );
    }
    for (const key of Object.keys(suite.execution)) {
      if (key === 'max_concurrency') {
        throw new Error(
          `Invalid eval runtime config in ${evalFilePath}: top-level 'execution.max_concurrency' has been removed. Use evaluate_options.max_concurrency for authored suite concurrency.`,
        );
      }
      throw new Error(
        `Invalid eval runtime config in ${evalFilePath}: top-level 'execution.${key}' is not part of eval YAML. Use supported top-level fields or evaluate_options for authored run controls.`,
      );
    }
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'execution' is not part of eval YAML. Use supported top-level fields or evaluate_options for authored run controls.`,
    );
  }
  if (suite.model !== undefined) {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'model' is not part of eval YAML. Put model inside the target object.`,
    );
  }
  if (suite.runs !== undefined) {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'runs' has been removed. Use evaluate_options.repeat.count instead.`,
    );
  }
  if (suite.early_exit !== undefined) {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'early_exit' has been removed. Use evaluate_options.repeat.early_exit instead.`,
    );
  }
  if (suite.repeat !== undefined) {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'repeat' has been removed. Use evaluate_options.repeat instead.`,
    );
  }
  if (suite.on_run_complete !== undefined) {
    throw new Error(
      `Invalid eval runtime config in ${evalFilePath}: top-level 'on_run_complete' has been removed. Use extensions with afterAll instead.`,
    );
  }
  return undefined;
}

function normalizeSuiteExperimentConfig(parsed: JsonObject): ExperimentConfig | undefined {
  const suite = parsed as RawTestSuite;
  readSuiteRuntimeBlock(suite, 'eval file');
  const suiteTargets = extractTargetsFromSuite(parsed);
  const singleSuiteTarget = suiteTargets?.length === 1 ? suiteTargets[0] : undefined;
  const experimentName = asString(suite.experiment);
  const budgetUsd = extractBudgetUsd(parsed);
  const evaluateOptions = isJsonObject(suite.evaluate_options) ? suite.evaluate_options : undefined;
  const runtimeConfig: JsonObject = {
    ...(experimentName !== undefined ? { name: experimentName } : {}),
    ...(singleSuiteTarget !== undefined ? { target: singleSuiteTarget } : {}),
    ...(evaluateOptions?.repeat !== undefined ? { repeat: evaluateOptions.repeat } : {}),
    ...(suite.timeout_seconds !== undefined ? { timeout_seconds: suite.timeout_seconds } : {}),
    ...(budgetUsd !== undefined ? { budget_usd: budgetUsd } : {}),
    ...(suite.threshold !== undefined ? { threshold: suite.threshold } : {}),
  };
  if (Object.keys(runtimeConfig).length === 0) {
    return undefined;
  }
  return normalizeExperimentConfig(runtimeConfig);
}

function parseEvalTargetSpec(rawTarget: JsonValue | undefined): EvalTargetSpec | undefined {
  if (rawTarget === undefined || rawTarget === null) {
    return undefined;
  }
  throw new Error("Top-level 'target' has been removed. Use top-level 'providers' instead.");
}

const SOURCE_SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)/i;
const REDACTED_SOURCE_VALUE = '[redacted]';

function buildRawInlineTestSnapshots(rawParsed: unknown): Map<string, string> {
  const snapshots = new Map<string, string>();
  if (!isJsonObject(rawParsed)) {
    return snapshots;
  }

  const rawTests = rawParsed.tests;
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
  readonly defaultTestReferences: readonly EvalSourceReference[];
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
    ...params.defaultTestReferences,
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

  if (evaluator.type === 'script') {
    const command = evaluator.command ?? [];
    references.push({
      kind: 'script_grader_command',
      displayPath: evaluator.resolvedScriptPath ?? command.join(' '),
      ...(evaluator.resolvedScriptPath ? { resolvedPath: evaluator.resolvedScriptPath } : {}),
      graderName: evaluator.name,
      command,
    });
    if (evaluator.resolvedCwd) {
      references.push({
        kind: 'script_grader_cwd',
        displayPath: evaluator.cwd ?? evaluator.resolvedCwd,
        resolvedPath: evaluator.resolvedCwd,
        graderName: evaluator.name,
      });
    }
  }

  if (evaluator.type === 'llm-grader') {
    const resolvedPromptPath = evaluator.resolvedPromptPath ?? evaluator.promptPath;
    if (resolvedPromptPath) {
      references.push({
        kind: 'llm_grader_prompt',
        displayPath:
          evaluator.promptPath ??
          (typeof evaluator.prompt === 'string' ? evaluator.prompt : resolvedPromptPath),
        resolvedPath: resolvedPromptPath,
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
        kind: 'content_transform_command',
        displayPath: preprocessor.resolvedCommand.at(-1) ?? preprocessor.type,
        resolvedPath: preprocessor.resolvedCommand.at(-1),
        graderName: evaluator.name,
        command: preprocessor.resolvedCommand,
      });
    }
  }

  if (evaluator.type === 'assert-set') {
    for (const member of evaluator.assertions) {
      references.push(...collectSingleGraderSourceReferences(member));
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
 * String assert entries are preserved as-is — they become rubric criteria at runtime.
 * Structured assertion objects pass through unchanged.
 */
function parseTurns(rawTurns: readonly unknown[]): ConversationTurn[] {
  return rawTurns.map((rawTurn) => {
    const turn = rawTurn as Record<string, unknown>;
    const input = turn.input as TestMessageContent;
    const expectedOutput = turn.expected_output as TestMessageContent | undefined;

    // Parse per-turn assertions (string shorthand or structured evaluator config)
    let assertions: (string | GraderConfig)[] | undefined;
    if (Array.isArray(turn.assert)) {
      assertions = turn.assert.map((a: unknown) => {
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
  if (obj.script !== undefined) {
    throw new Error("Workspace hook field 'script' has been removed. Use 'command' instead.");
  }

  const command = parseCommandArray(obj.command);
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
  const commandConfig = parseWorkspaceScriptConfig(raw, evalFileDir);
  const obj = raw as Record<string, unknown>;
  const reset =
    obj.reset === 'none' || obj.reset === 'fast' || obj.reset === 'strict' ? obj.reset : undefined;
  if (!commandConfig && !reset) return undefined;
  return {
    ...(commandConfig ?? {}),
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

const EXTENSION_HOOKS = new Set(['beforeAll', 'beforeEach', 'afterEach', 'afterAll']);

function parseExtensions(raw: unknown, evalFileDir: string): AgentVExtensionConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error('extensions must be an array');
  }

  return raw.map((entry, index) => parseExtension(entry, index, evalFileDir));
}

function parseExtension(entry: unknown, index: number, evalFileDir: string): AgentVExtensionConfig {
  if (typeof entry === 'string') {
    return parseExtensionString(entry, `extensions[${index}]`, evalFileDir);
  }
  if (!isJsonObject(entry)) {
    throw new Error(`extensions[${index}] must be a string or object`);
  }

  const obj = entry as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : undefined;
  if (id !== 'agentv:agent-rules') {
    throw new Error(`extensions[${index}].id must be agentv:agent-rules`);
  }
  const hook = parseExtensionHook(obj.hook, `extensions[${index}].hook`) ?? 'beforeAll';
  const source = isJsonObject(obj.config) ? (obj.config as Record<string, unknown>) : obj;
  return {
    id,
    hook,
    ...(readPathList(source.skills, `extensions[${index}].skills`) ?? {}),
    ...(readPathList(source.hooks, `extensions[${index}].hooks`) ?? {}),
    ...(readPathList(source.agents, `extensions[${index}].agents`) ?? {}),
    ...(readPathList(source.rules, `extensions[${index}].rules`) ?? {}),
  };
}

function parseExtensionString(
  raw: string,
  label: string,
  evalFileDir: string,
): AgentVExtensionConfig {
  if (raw === 'agentv:agent-rules') {
    return { id: 'agentv:agent-rules', hook: 'beforeAll' };
  }
  if (raw.startsWith('agentv:agent-rules:')) {
    const hook = parseExtensionHook(raw.slice('agentv:agent-rules:'.length), label);
    if (!hook) {
      throw new Error(`${label} must use one of beforeAll, beforeEach, afterEach, afterAll`);
    }
    return { id: 'agentv:agent-rules', hook };
  }
  if (!raw.startsWith('file://')) {
    throw new Error(`${label} must start with file:// or agentv:agent-rules`);
  }

  const lastColon = raw.lastIndexOf(':');
  if (lastColon <= 'file://'.length) {
    throw new Error(`${label} must be of the form file://path/to/hook.ts:beforeAll`);
  }
  const functionName = raw.slice(lastColon + 1);
  const hook = parseExtensionHook(functionName, label);
  if (!hook) {
    throw new Error(`${label} must target one of beforeAll, beforeEach, afterEach, afterAll`);
  }
  const filePart = raw.slice('file://'.length, lastColon);
  if (!filePart) {
    throw new Error(`${label} must include a file path`);
  }
  const resolvedPath = path.isAbsolute(filePart) ? filePart : path.resolve(evalFileDir, filePart);
  return {
    id: raw,
    hook,
    path: resolvedPath,
    functionName: hook,
  };
}

function parseExtensionHook(raw: unknown, label: string): ExtensionLifecycleHook | undefined {
  if (typeof raw !== 'string') return undefined;
  if (!EXTENSION_HOOKS.has(raw)) {
    throw new Error(`${label} must be one of beforeAll, beforeEach, afterEach, afterAll`);
  }
  return raw as ExtensionLifecycleHook;
}

function readPathList(raw: unknown, label: string): Partial<AgentRulesPaths> | undefined {
  if (raw === undefined) return undefined;
  const values =
    typeof raw === 'string'
      ? [raw]
      : Array.isArray(raw)
        ? raw.filter((entry): entry is string => typeof entry === 'string')
        : undefined;
  if (!values) {
    throw new Error(`${label} must be a string or string array`);
  }
  const key = label.split('.').at(-1) as keyof AgentRulesExtensionConfig | undefined;
  return key ? ({ [key]: values } as Partial<AgentRulesPaths>) : undefined;
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
      'workspace.pool has been removed from eval YAML. Use environment for portable testbed setup, or --workspace-path for a machine-local static workspace.',
    );
  }
  if ('static' in obj) {
    throw new Error(
      'workspace.static has been removed from eval YAML. Put existing workspace paths in .agentv/config.local.yaml execution.workspace_path or pass --workspace-path.',
    );
  }
  if ('mode' in obj) {
    throw new Error(
      'workspace.mode has been removed from eval YAML. Use environment for portable testbed setup, or --workspace-path for machine-local existing directories.',
    );
  }
  if ('path' in obj) {
    throw new Error(
      'workspace.path has been removed from eval YAML. Put existing workspace paths in .agentv/config.local.yaml execution.workspace_path or pass --workspace-path.',
    );
  }
  if ('template' in obj) {
    throw new Error(
      'workspace.template has been removed from public eval YAML. Use environment.workdir and environment.setup for authored testbed setup.',
    );
  }
  if ('repos' in obj) {
    throw new Error(
      'workspace.repos has been removed from public eval YAML. Use environment.setup.command argv to materialize repositories.',
    );
  }
  if ('docker' in obj) {
    throw new Error(
      'workspace.docker has been removed from public eval YAML. Use environment.type: docker with image or context.',
    );
  }
  if ('scope' in obj) {
    throw new Error(
      'workspace.scope has been removed from public eval YAML. Use environment at suite/test scope and let runtime manage workspace lifetime.',
    );
  }

  if ('isolation' in obj) {
    throw new Error(
      'workspace.isolation has been removed. Use environment at suite/test scope and let AgentV manage runtime isolation.',
    );
  }

  const hooks = parseWorkspaceHooksConfig(obj.hooks, evalFileDir);
  const env = parseWorkspaceEnvConfig(obj.env);

  if (!hooks && !env) return undefined;

  return {
    ...(hooks !== undefined && { hooks }),
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
    scope: caseLevel.scope ?? suiteLevel.scope,
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
  const rawMetadata = isJsonObject(suite.metadata)
    ? (suite.metadata as Record<string, unknown>)
    : {};
  // `tags` is handled explicitly: the list form is inherited as per-case
  // selection metadata, while the map form (promptfoo-shaped) is carried on the
  // suite via EvalSuiteResult.tags and is intentionally dropped here so it does
  // not pollute per-case selection tags.
  const payload: Record<string, unknown> = Object.fromEntries(
    Object.entries(rawMetadata).filter(([key]) => key !== 'tags'),
  );

  const suiteTags = readMetadataTags(suite.tags);
  const metadataTags = readMetadataTags(rawMetadata.tags);
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
