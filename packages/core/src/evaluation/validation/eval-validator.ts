import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

import { interpolateEnv } from '../interpolation.js';
import { loadCasesFromDirectory, loadCasesFromFile } from '../loaders/case-file-loader.js';
import { buildSearchRoots } from '../loaders/file-resolver.js';
import { loadPromptMdFallback } from '../loaders/prompt-md-fallback.js';
import { isGraderKind } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';
import type { ValidationError, ValidationResult } from './types.js';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];
type SuiteImportStackEntry = {
  readonly identity: string;
  readonly displayPath: string;
  readonly filePath: string;
};

/** Assertion grader types that require a string `value` field. */
const ASSERTION_TYPES_WITH_STRING_VALUE = new Set([
  'contains',
  'icontains',
  'starts-with',
  'ends-with',
  'equals',
  'regex',
]);
/** Assertion grader types that require a string[] `value` field. */
const ASSERTION_TYPES_WITH_ARRAY_VALUE = new Set([
  'contains-any',
  'contains-all',
  'icontains-any',
  'icontains-all',
]);

/** Valid file extensions for external test files. */
const VALID_TEST_FILE_EXTENSIONS = new Set(['.yaml', '.yml', '.jsonl']);

/** Known fields at the top level of an eval file. */
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  '$schema',
  'name',
  'description',
  'category',
  'version',
  'author',
  'tags',
  'license',
  'requires',
  'input',
  'input_files',
  'tests',
  'target',
  'experiment',
  'execution',
  'assertions',
  'evaluators',
  'preprocessors',
  'workspace',
  'metadata',
  'governance',
]);

/** Known fields on tests[] include entries. */
const KNOWN_INCLUDE_FIELDS = new Set(['include', 'type', 'select', 'run']);
const KNOWN_RUN_OVERRIDE_FIELDS = new Set(['threshold', 'repeat', 'timeout_seconds', 'budget_usd']);
const KNOWN_REPEAT_STRATEGIES = new Set(['pass_at_k', 'pass_all', 'mean', 'confidence_interval']);
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

/**
 * Deprecated top-level fields with migration hints.
 * These are still processed by yaml-parser but authors should migrate.
 */
const DEPRECATED_TOP_LEVEL_FIELDS = new Map<string, string>([
  ['eval_cases', "'eval_cases' is deprecated. Use 'tests' instead."],
  ['evalcases', "'evalcases' is deprecated. Use 'tests' instead."],
  ['evaluator', "'evaluator' is deprecated. Use 'assertions' instead."],
  ['assert', "'assert' is deprecated. Use 'assertions' instead."],
]);

/** Known fields at the test level. */
const KNOWN_TEST_FIELDS = new Set([
  'id',
  'vars',
  'criteria',
  'input',
  'input_files',
  'expected_output',
  'assertions',
  'evaluators',
  'rubrics',
  'execution',
  'run',
  'workspace',
  'metadata',
  'conversation_id',
  'suite',
  'depends_on',
  'on_dependency_failure',
  'mode',
  'turns',
  'aggregation',
  'on_turn_failure',
  'window_size',
]);

/**
 * Deprecated test-level fields with migration hints.
 * These are still processed by yaml-parser but authors should migrate.
 */
const DEPRECATED_TEST_FIELDS = new Map<string, string>([
  ['evaluator', "'evaluator' is deprecated. Use 'assertions' instead."],
  ['assert', "'assert' is deprecated. Use 'assertions' instead."],
  ['expected_outcome', "'expected_outcome' is deprecated. Use 'criteria' instead."],
]);

/** Name field pattern: lowercase alphanumeric with hyphens. */
const NAME_PATTERN = /^[a-z0-9-]+$/;

/** Script file extensions recognised as custom assertion plugins. */
const ASSERTION_SCRIPT_EXTENSIONS = new Set(['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs']);

/** Cache: directory path → promise of discovered type names. */
const customAssertionCache = new Map<string, Promise<Set<string>>>();

/**
 * Walk up the directory tree from `baseDir` collecting type names from
 * `.agentv/assertions/` directories — mirrors the runtime discovery in
 * `assertion-discovery.ts`.
 *
 * Results are cached by directory so concurrent validation of many files
 * in the same directory only does the filesystem walk once.
 */
function discoverCustomAssertionTypes(baseDir: string): Promise<Set<string>> {
  const resolved = path.resolve(baseDir);
  const cached = customAssertionCache.get(resolved);
  if (cached) return cached;

  const promise = (async () => {
    const types = new Set<string>();
    let dir = resolved;
    const root = path.parse(dir).root;

    while (dir !== root) {
      const assertionsDir = path.join(dir, '.agentv', 'assertions');
      try {
        const entries = await readdir(assertionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (!ASSERTION_SCRIPT_EXTENSIONS.has(ext)) continue;
          types.add(entry.name.slice(0, -ext.length));
        }
      } catch {
        // Directory doesn't exist — skip
      }
      dir = path.dirname(dir);
    }

    return types;
  })();

  customAssertionCache.set(resolved, promise);
  return promise;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIncludeEntry(value: JsonObject): value is JsonObject & { include: string } {
  return typeof value.include === 'string' && value.include.trim().length > 0;
}

async function canonicalEvalFileIdentity(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  return realpath(absolutePath).catch(() => absolutePath);
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

/**
 * Validate an eval file (agentv-eval-v2 schema).
 */
export async function validateEvalFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const absolutePath = path.resolve(filePath);
  const customAssertionTypes = await discoverCustomAssertionTypes(path.dirname(absolutePath));

  let parsed: unknown;
  try {
    const content = await readFile(absolutePath, 'utf8');
    parsed = interpolateEnv(parseYamlValue(content), process.env);
  } catch (error) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: `Failed to parse YAML: ${(error as Error).message}`,
    });
    return {
      valid: false,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  if (!isObject(parsed)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      message: 'File must contain a YAML object',
    });
    return {
      valid: false,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  // Validate metadata fields
  validateMetadata(parsed, absolutePath, errors);

  if (parsed.experiment !== undefined && parsed.execution !== undefined) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      location: 'experiment',
      message: "Use either top-level 'experiment' or legacy 'execution', not both.",
    });
  }

  // Warn on deprecated or unknown top-level fields
  for (const key of Object.keys(parsed)) {
    const deprecationMessage = DEPRECATED_TOP_LEVEL_FIELDS.get(key);
    if (deprecationMessage) {
      errors.push({
        severity: 'warning',
        filePath: absolutePath,
        location: key,
        message: deprecationMessage,
      });
    } else if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) {
      errors.push({
        severity: 'warning',
        filePath: absolutePath,
        location: key,
        message: `Unknown field '${key}'. This field will be ignored.`,
      });
    }
  }

  // Validate suite-level input (optional: string/object shorthand or message array)
  validateInputField(parsed.input, 'input', absolutePath, errors);

  await validateSuiteWorkspaceConfigs(parsed, absolutePath, errors);

  const cases: JsonValue | undefined = parsed.tests;

  // tests can be a string path (external file/directory reference) or an array
  if (typeof cases === 'string') {
    await validateRawCaseImportPath(cases, absolutePath, 'tests', errors);

    return {
      valid: errors.filter((e) => e.severity === 'error').length === 0,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  if (!Array.isArray(cases)) {
    errors.push({
      severity: 'error',
      filePath: absolutePath,
      location: 'tests',
      message: "Missing or invalid 'tests' field (must be an array or a file path string)",
    });
    return {
      valid: errors.length === 0,
      filePath: absolutePath,
      fileType: 'eval',
      errors,
    };
  }

  // Validate each eval case
  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const location = `tests[${i}]`;

    // Tests array items can be file references (e.g., "file://cases/accuracy.yaml")
    if (typeof evalCase === 'string') {
      await validateRawCaseImportPath(evalCase, absolutePath, location, errors);
      continue;
    }

    if (!isObject(evalCase)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location,
        message: 'Eval case must be an object',
      });
      continue;
    }

    if (isIncludeEntry(evalCase)) {
      validateIncludeEntry(evalCase, location, absolutePath, errors);
      continue;
    }

    // Warn on deprecated or unknown test-level fields
    for (const key of Object.keys(evalCase)) {
      const deprecationMessage = DEPRECATED_TEST_FIELDS.get(key);
      if (deprecationMessage) {
        errors.push({
          severity: 'warning',
          filePath: absolutePath,
          location: `${location}.${key}`,
          message: deprecationMessage,
        });
      } else if (!KNOWN_TEST_FIELDS.has(key)) {
        errors.push({
          severity: 'warning',
          filePath: absolutePath,
          location: `${location}.${key}`,
          message: `Unknown field '${key}'. This field will be ignored.`,
        });
      }
    }

    // Required fields: id, input
    const id = evalCase.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.id`,
        message: "Missing or invalid 'id' field (must be a non-empty string)",
      });
    }

    // Optional: criteria
    const criteria = evalCase.criteria;
    if (criteria !== undefined && (typeof criteria !== 'string' || criteria.trim().length === 0)) {
      errors.push({
        severity: 'error',
        filePath: absolutePath,
        location: `${location}.criteria`,
        message: "Invalid 'criteria' field (must be a non-empty string if provided)",
      });
    }

    // input field (string/object shorthand or message array). When omitted,
    // AgentV accepts Vercel-style PROMPT.md fallback beside EVAL.yaml or in input_files.
    const caseExecution = isObject(evalCase.execution) ? evalCase.execution : undefined;
    if (caseExecution) {
      validateTestExecutionFields(caseExecution, absolutePath, errors, location);
      rejectRuntimeWorkspaceConfig(
        caseExecution.workspace,
        absolutePath,
        errors,
        `${location}.execution.workspace`,
      );
    }
    const skipDefaults = caseExecution?.skip_defaults === true;
    const hasPromptMdFallback =
      evalCase.input === undefined
        ? (await loadPromptMdFallback({
            evalFilePath: absolutePath,
            searchRoots: buildSearchRoots(absolutePath, process.cwd()),
            testInputFiles: evalCase.input_files,
            suiteInputFiles: skipDefaults ? undefined : parsed.input_files,
          })) !== undefined
        : false;
    validateInputField(evalCase.input, `${location}.input`, absolutePath, errors, {
      required: !hasPromptMdFallback,
    });

    // expected_output field (string/object shorthand or message array)
    const expectedOutputField = evalCase.expected_output;
    if (expectedOutputField !== undefined) {
      if (typeof expectedOutputField === 'string') {
        // String shorthand is valid - no further validation needed
      } else if (Array.isArray(expectedOutputField)) {
        // Check if it looks like a message array (first element has 'role')
        if (
          expectedOutputField.length > 0 &&
          isObject(expectedOutputField[0]) &&
          'role' in expectedOutputField[0]
        ) {
          validateMessages(
            expectedOutputField,
            `${location}.expected_output`,
            absolutePath,
            errors,
          );
        }
        // Otherwise it's treated as structured array content - valid
      } else if (isObject(expectedOutputField)) {
        // Object shorthand or single message - both are valid
      } else {
        errors.push({
          severity: 'error',
          filePath: absolutePath,
          location: `${location}.expected_output`,
          message: "Invalid 'expected_output' field (must be a string, object, or array)",
        });
      }
    }

    // assertions field (array of assertion objects)
    const assertField = evalCase.assertions;
    if (assertField !== undefined) {
      validateAssertArray(assertField, location, absolutePath, errors, customAssertionTypes);
    }

    validateRunOverride(evalCase.run, `${location}.run`, absolutePath, errors);

    // Cross-field validation for conversation mode
    validateConversationMode(evalCase, location, absolutePath, errors);

    await validateWorkspaceConfig(
      evalCase.workspace,
      absolutePath,
      errors,
      `${location}.workspace`,
    );
  }

  await validateCompositionDiagnostics(absolutePath, parsed, errors);
  await validateSuiteImportCycles(absolutePath, parsed, errors);

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    filePath: absolutePath,
    fileType: 'eval',
    errors,
  };
}

async function validateSuiteWorkspaceConfigs(
  parsed: JsonObject,
  absolutePath: string,
  errors: ValidationError[],
): Promise<void> {
  await validateWorkspaceConfig(parsed.workspace, absolutePath, errors, 'workspace');
  if (isObject(parsed.experiment)) {
    rejectRuntimeWorkspaceConfig(
      parsed.experiment.workspace,
      absolutePath,
      errors,
      'experiment.workspace',
    );
  }
  if (isObject(parsed.execution)) {
    rejectRuntimeWorkspaceConfig(
      parsed.execution.workspace,
      absolutePath,
      errors,
      'execution.workspace',
    );
  }
}

function validateTestExecutionFields(
  caseExecution: JsonObject,
  filePath: string,
  errors: ValidationError[],
  location: string,
): void {
  for (const key of Object.keys(caseExecution)) {
    if (!KNOWN_TEST_EXECUTION_FIELDS.has(key)) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.execution.${key}`,
        message: `Unsupported test execution field '${key}'.`,
      });
    }
  }
}

function rejectRuntimeWorkspaceConfig(
  workspace: JsonValue | undefined,
  filePath: string,
  errors: ValidationError[],
  location: string,
): void {
  if (workspace === undefined) {
    return;
  }

  errors.push({
    severity: 'error',
    filePath,
    location,
    message: `${location} has been removed from eval YAML. Put machine-local workspace_path/workspace_mode in .agentv/config.local.yaml under execution, or pass --workspace-path/--workspace-mode. Keep portable task setup in top-level workspace.`,
  });
}

async function validateCompositionDiagnostics(
  filePath: string,
  parsed: JsonObject,
  errors: ValidationError[],
): Promise<void> {
  const tests = parsed.tests;
  if (!Array.isArray(tests)) {
    return;
  }

  const parentHasRuntime = parsed.experiment !== undefined || parsed.execution !== undefined;
  const hasSuiteImport = tests.some(
    (entry) => isObject(entry) && isIncludeEntry(entry) && entry.type === 'suite',
  );

  if (hasSuiteImport) {
    for (const location of parentWorkspaceLocations(parsed)) {
      errors.push({
        severity: 'error',
        filePath,
        location,
        message:
          'Parent workspace is not allowed when an eval imports suites with type: suite. A wrapper eval owns runtime policy, while imported suites own task environment. Move workspace into the child suite, or import raw cases with type: tests when you intentionally want parent workspace context.',
      });
    }
  }

  for (let i = 0; i < tests.length; i++) {
    const entry = tests[i];
    if (!isObject(entry) || !isIncludeEntry(entry)) {
      continue;
    }

    const includePath = entry.include.trim();
    const location = `tests[${i}].include`;
    const resolvedSuites = await resolveSuiteIncludePaths(includePath, path.dirname(filePath));

    if (entry.type === 'suite') {
      for (const resolvedSuite of resolvedSuites) {
        const childParsed = await readImportedSuite(resolvedSuite.filePath);
        if (!childParsed) {
          continue;
        }
        const runtimeField =
          childParsed.experiment !== undefined
            ? 'experiment'
            : childParsed.execution !== undefined
              ? 'legacy execution'
              : undefined;
        if (!runtimeField) {
          continue;
        }

        errors.push({
          severity: 'warning',
          filePath,
          location,
          message: parentHasRuntime
            ? `Imported suite '${resolvedSuite.displayPath}' defines ${runtimeField}, but child experiment blocks are ignored for type: suite imports. The parent experiment owns wrapper runtime; move runtime settings to the parent experiment or use tests[].run for per-case thresholds, repeats, timeouts, and budgets.`
            : `Imported suite '${resolvedSuite.displayPath}' defines ${runtimeField}, but child experiment blocks are ignored for type: suite imports. The parent experiment owns wrapper runtime, and this parent has no experiment, so no child runtime settings are applied. Add a parent experiment or use tests[].run for per-case thresholds, repeats, timeouts, and budgets.`,
        });
      }
      continue;
    }

    if (entry.type === 'tests') {
      for (const resolvedSuite of resolvedSuites) {
        if (!/\.eval\.ya?ml$/i.test(resolvedSuite.filePath)) {
          continue;
        }
        errors.push({
          severity: 'warning',
          filePath,
          location,
          message: `type: tests imports raw cases from eval suite '${resolvedSuite.displayPath}' and drops suite context, including child workspace, input, assertions, metadata, and experiment. Parent suite context applies. Use type: suite to preserve child test and workspace semantics.`,
        });
      }
    }
  }
}

function parentWorkspaceLocations(parsed: JsonObject): readonly string[] {
  const locations: string[] = [];
  if (parsed.workspace !== undefined) {
    locations.push('workspace');
  }
  if (isObject(parsed.experiment) && parsed.experiment.workspace !== undefined) {
    locations.push('experiment.workspace');
  }
  if (isObject(parsed.execution) && parsed.execution.workspace !== undefined) {
    locations.push('execution.workspace');
  }
  return locations;
}

async function readImportedSuite(filePath: string): Promise<JsonObject | undefined> {
  try {
    const parsed = interpolateEnv(parseYamlValue(await readFile(filePath, 'utf8')), process.env);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function validateIncludeEntry(
  entry: JsonObject,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  for (const key of Object.keys(entry)) {
    if (!KNOWN_INCLUDE_FIELDS.has(key)) {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${location}.${key}`,
        message: `Unknown field '${key}'. This field will be ignored.`,
      });
    }
  }

  if (typeof entry.include !== 'string' || entry.include.trim().length === 0) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.include`,
      message: "Invalid 'include' field (must be a non-empty string)",
    });
  }

  if (entry.type === undefined) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.type`,
      message: "Missing 'type' field (must be 'suite' or 'tests')",
    });
  } else if (entry.type !== 'suite' && entry.type !== 'tests') {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.type`,
      message: "Invalid 'type' field (must be 'suite' or 'tests')",
    });
  }

  validateIncludeSelect(entry.select, `${location}.select`, filePath, errors);
  validateRunOverride(entry.run, `${location}.run`, filePath, errors);
}

function validateRunOverride(
  run: JsonValue | undefined,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  if (run === undefined) {
    return;
  }
  if (!isObject(run)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: "Invalid 'run' override (must be an object)",
    });
    return;
  }

  for (const key of Object.keys(run)) {
    if (!KNOWN_RUN_OVERRIDE_FIELDS.has(key)) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.${key}`,
        message:
          'Invalid run override field. Supported fields: threshold, repeat, timeout_seconds, budget_usd.',
      });
    }
  }

  const threshold = run.threshold;
  if (
    threshold !== undefined &&
    (typeof threshold !== 'number' || threshold < 0 || threshold > 1)
  ) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.threshold`,
      message: "Invalid 'threshold' field (must be a number between 0 and 1)",
    });
  }

  const timeoutSeconds = run.timeout_seconds;
  if (timeoutSeconds !== undefined && (typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0)) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.timeout_seconds`,
      message: "Invalid 'timeout_seconds' field (must be a positive number)",
    });
  }

  const budgetUsd = run.budget_usd;
  if (budgetUsd !== undefined && (typeof budgetUsd !== 'number' || budgetUsd <= 0)) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.budget_usd`,
      message: "Invalid 'budget_usd' field (must be a positive number)",
    });
  }

  validateRepeatOverride(run.repeat, `${location}.repeat`, filePath, errors);
}

function validateRepeatOverride(
  repeat: JsonValue | undefined,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  if (repeat === undefined) {
    return;
  }
  if (!isObject(repeat)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: "Invalid 'repeat' field (must be an object)",
    });
    return;
  }

  if (typeof repeat.count !== 'number' || !Number.isInteger(repeat.count) || repeat.count < 1) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.count`,
      message: "Invalid 'count' field (must be a positive integer)",
    });
  }

  if (
    repeat.strategy !== undefined &&
    (typeof repeat.strategy !== 'string' || !KNOWN_REPEAT_STRATEGIES.has(repeat.strategy))
  ) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.strategy`,
      message:
        "Invalid 'strategy' field (must be pass_at_k, pass_all, mean, or confidence_interval)",
    });
  }

  const costLimit = repeat.cost_limit_usd;
  if (costLimit !== undefined && (typeof costLimit !== 'number' || costLimit < 0)) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.cost_limit_usd`,
      message: "Invalid 'cost_limit_usd' field (must be a non-negative number)",
    });
  }
}

function validateIncludeSelect(
  select: JsonValue | undefined,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  if (select === undefined || typeof select === 'string') {
    return;
  }
  if (Array.isArray(select)) {
    if (!select.every((value) => typeof value === 'string')) {
      errors.push({
        severity: 'error',
        filePath,
        location,
        message: "Invalid 'select' field (array values must be strings)",
      });
    }
    return;
  }
  if (!isObject(select)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message: "Invalid 'select' field (must be a string, string array, or object)",
    });
    return;
  }

  for (const [key, value] of Object.entries(select)) {
    if (key !== 'test_ids' && key !== 'tags' && key !== 'metadata') {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${location}.${key}`,
        message: `Unknown field '${key}'. This field will be ignored.`,
      });
      continue;
    }

    if (key === 'metadata') {
      if (!isObject(value)) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.metadata`,
          message: "Invalid 'metadata' selector (must be an object)",
        });
      }
      continue;
    }

    if (
      typeof value !== 'string' &&
      !(Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
    ) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${location}.${key}`,
        message: `Invalid '${key}' selector (must be a string or string array)`,
      });
    }
  }
}

async function validateWorkspaceConfig(
  workspace: JsonValue | undefined,
  evalFilePath: string,
  errors: ValidationError[],
  location: string,
): Promise<void> {
  if (workspace === undefined) {
    return;
  }

  if (isObject(workspace)) {
    validateWorkspaceRepoConfig(workspace, evalFilePath, errors, location);
    return;
  }

  if (typeof workspace !== 'string') {
    return;
  }

  const workspacePath = path.resolve(path.dirname(evalFilePath), workspace);

  try {
    const workspaceContent = await readFile(workspacePath, 'utf8');
    const parsedWorkspace = interpolateEnv(parseYamlValue(workspaceContent), process.env);
    if (!isObject(parsedWorkspace)) {
      errors.push({
        severity: 'error',
        filePath: evalFilePath,
        location,
        message: `External workspace file must contain a YAML object: ${workspace}`,
      });
      return;
    }

    validateWorkspaceRepoConfig(parsedWorkspace, workspacePath, errors, location);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({
      severity: 'error',
      filePath: evalFilePath,
      location,
      message: `Failed to load external workspace file '${workspace}': ${message}`,
    });
  }
}

function validateWorkspaceRepoConfig(
  workspace: JsonObject,
  filePath: string,
  errors: ValidationError[],
  location: string,
): void {
  const repos = workspace.repos;
  const hooks = workspace.hooks;
  const afterEachHook = isObject(hooks) ? hooks.after_each : undefined;
  const isolation = workspace.isolation;

  const docker = workspace.docker;

  if ('mode' in workspace) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.mode`,
      message:
        'workspace.mode has been removed from eval YAML. Use workspace.isolation: shared|per_case for folder isolation; use --workspace-mode or config.local.yaml execution.workspace_mode only for machine-local runtime overrides.',
    });
  }

  if ('path' in workspace) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.path`,
      message:
        'workspace.path has been removed from eval YAML. Put existing workspace paths in .agentv/config.local.yaml execution.workspace_path or pass --workspace-path.',
    });
  }

  if (isolation !== undefined && isolation !== 'shared' && isolation !== 'per_case') {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.isolation`,
      message: "workspace.isolation must be 'shared' or 'per_case'.",
    });
  }

  if (Array.isArray(repos)) {
    for (const repo of repos) {
      if (!isObject(repo)) continue;

      if ('source' in repo) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.repos[path=${repo.path ?? '(none)'}]`,
          message: 'workspace.repos[].source has been removed. Use workspace.repos[].repo.',
        });
      }

      if ('checkout' in repo) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.repos[path=${repo.path ?? '(none)'}]`,
          message:
            'workspace.repos[].checkout has been removed. Use top-level commit, base_commit, and ancestor.',
        });
      }

      if ('clone' in repo) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.repos[path=${repo.path ?? '(none)'}]`,
          message: 'workspace.repos[].clone has been removed. Use top-level sparse if needed.',
        });
      }

      if (!repo.repo && !isObject(docker)) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.repos[path=${repo.path ?? '(none)'}]`,
          message:
            'repos[].repo is required for non-Docker workspaces. ' +
            'Repo-less entries are only valid when workspace.docker is configured.',
        });
      }

      if (
        typeof repo.commit === 'string' &&
        typeof repo.base_commit === 'string' &&
        repo.commit !== repo.base_commit
      ) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.repos[path=${repo.path ?? '(none)'}]`,
          message: 'repos[].commit and repos[].base_commit must match when both are set.',
        });
      }
    }
  }

  // after_each reset with per-case isolation warning
  if (isObject(afterEachHook) && afterEachHook.reset && isolation === 'per_case') {
    errors.push({
      severity: 'warning',
      filePath,
      location: `${location}.hooks.after_each`,
      message:
        'hooks.after_each.reset is redundant with isolation: per_case (each test gets a fresh workspace).',
    });
  }
}

function validateMessages(
  messages: JsonArray,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const msgLocation = `${location}[${i}]`;

    if (!isObject(message)) {
      errors.push({
        severity: 'error',
        filePath,
        location: msgLocation,
        message: 'Message must be an object',
      });
      continue;
    }

    // Validate role field
    const role = message.role;
    const validRoles = ['system', 'user', 'assistant', 'tool'];
    if (!validRoles.includes(role as string)) {
      errors.push({
        severity: 'error',
        filePath,
        location: `${msgLocation}.role`,
        message: `Invalid role '${role}'. Must be one of: ${validRoles.join(', ')}`,
      });
    }

    // Validate content field (can be string, array, or object)
    // Messages with tool_calls may omit content entirely (e.g., assistant tool-call messages).
    const content = message.content;
    const hasToolCalls = 'tool_calls' in message;
    if (content === undefined && hasToolCalls) {
      // Valid: assistant message with tool_calls but no content
    } else if (typeof content === 'string') {
      validateContentForRoleMarkers(content, `${msgLocation}.content`, filePath, errors);
    } else if (Array.isArray(content)) {
      // Array content - validate each element
      for (let j = 0; j < content.length; j++) {
        const contentItem = content[j];
        const contentLocation = `${msgLocation}.content[${j}]`;

        if (typeof contentItem === 'string') {
          validateContentForRoleMarkers(contentItem, contentLocation, filePath, errors);
        } else if (isObject(contentItem)) {
          const type = contentItem.type;
          if (typeof type !== 'string') {
            errors.push({
              severity: 'error',
              filePath,
              location: `${contentLocation}.type`,
              message: "Content object must have a 'type' field",
            });
          }

          // For 'file' type, we'll validate existence later in file-reference-validator
          // For 'text' type, require 'value' field
          if (type === 'text') {
            const value = contentItem.value;
            if (typeof value !== 'string') {
              errors.push({
                severity: 'error',
                filePath,
                location: `${contentLocation}.value`,
                message: "Content with type 'text' must have a 'value' field",
              });
            } else {
              validateContentForRoleMarkers(value, `${contentLocation}.value`, filePath, errors);
            }
          }
        } else {
          errors.push({
            severity: 'error',
            filePath,
            location: contentLocation,
            message: 'Content array items must be strings or objects',
          });
        }
      }
    } else if (isObject(content)) {
      // Structured content objects (e.g., { decision: "CLEAR" }) are valid
      // — the runtime accepts them for expected_output and input messages.
    } else {
      errors.push({
        severity: 'error',
        filePath,
        location: `${msgLocation}.content`,
        message: "Missing or invalid 'content' field (must be a string, array, or object)",
      });
    }
  }
}

function validateInputField(
  inputField: JsonValue | undefined,
  location: string,
  filePath: string,
  errors: ValidationError[],
  options: { readonly required?: boolean } = {},
): void {
  if (inputField === undefined) {
    if (options.required) {
      errors.push({
        severity: 'error',
        filePath,
        location,
        message:
          "Missing 'input' field (provide a string, object, message array, or PROMPT.md next to EVAL.yaml / referenced in input_files)",
      });
    }
    return;
  }

  if (typeof inputField === 'string') {
    // String shorthand is valid.
    return;
  }

  if (Array.isArray(inputField)) {
    validateMessages(inputField, location, filePath, errors);
    return;
  }

  if (isObject(inputField)) {
    if ('role' in inputField) {
      validateMessages([inputField], location, filePath, errors);
    }
    // Structured object shorthand is valid and expands to one user message.
    return;
  }

  const label = location === 'input' ? "suite-level 'input'" : "'input'";
  errors.push({
    severity: 'error',
    filePath,
    location,
    message: `Invalid ${label} field (must be a string, object, or array of messages)`,
  });
}

function validateMetadata(parsed: JsonObject, filePath: string, errors: ValidationError[]): void {
  const name = parsed.name;
  if (name !== undefined) {
    if (typeof name === 'string') {
      if (!NAME_PATTERN.test(name)) {
        errors.push({
          severity: 'warning',
          filePath,
          location: 'name',
          message: `Invalid 'name' format '${name}'. Must match pattern /^[a-z0-9-]+$/ (lowercase alphanumeric with hyphens).`,
        });
      }
    }
  }
}

function validateTestsStringPath(
  testsPath: string,
  filePath: string,
  errors: ValidationError[],
  location = 'tests',
): boolean {
  const normalizedPath = testsPath.startsWith('file://')
    ? testsPath.slice('file://'.length)
    : testsPath;
  if (/\.eval\.ya?ml$/i.test(normalizedPath)) {
    errors.push({
      severity: 'error',
      filePath,
      location,
      message:
        'tests shorthand imports raw case files only. Use an include entry with type: suite to import eval suites.',
    });
    return false;
  }
  const ext = path.extname(normalizedPath);
  if (ext && !VALID_TEST_FILE_EXTENSIONS.has(ext)) {
    errors.push({
      severity: 'warning',
      filePath,
      location,
      message: `Unsupported file extension '${ext}' for tests path '${testsPath}'. Supported extensions: ${[...VALID_TEST_FILE_EXTENSIONS].join(', ')}`,
    });
    return false;
  }
  return true;
}

function hasGlobMagic(value: string): boolean {
  return /[*?[\]{}()!+@]/.test(value);
}

async function validateRawCaseImportPath(
  testsPath: string,
  filePath: string,
  location: string,
  errors: ValidationError[],
): Promise<void> {
  if (!validateTestsStringPath(testsPath, filePath, errors, location)) {
    return;
  }

  const rawPath = testsPath.startsWith('file://') ? testsPath.slice('file://'.length) : testsPath;
  const absolutePath = path.resolve(path.dirname(filePath), rawPath);
  try {
    const caseFiles = hasGlobMagic(rawPath)
      ? (
          await fg(absolutePath.replaceAll('\\', '/'), {
            onlyFiles: true,
            absolute: true,
          })
        ).sort()
      : [absolutePath];

    let caseIndex = 0;
    for (const casePath of caseFiles) {
      const pathStat = await stat(casePath).catch(() => undefined);
      const externalCases = pathStat?.isDirectory()
        ? await loadCasesFromDirectory(casePath)
        : await loadCasesFromFile(casePath);
      for (const externalCase of externalCases) {
        await validateWorkspaceConfig(
          externalCase.workspace,
          filePath,
          errors,
          `${location}[${caseIndex}].workspace`,
        );
        caseIndex += 1;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({
      severity: 'error',
      filePath,
      location,
      message,
    });
  }
}

async function resolveSuiteIncludePaths(
  includePath: string,
  evalFileDir: string,
): Promise<readonly SuiteImportStackEntry[]> {
  const absolutePattern = path.resolve(evalFileDir, includePath);
  const matches = hasGlobMagic(includePath)
    ? (
        await fg(absolutePattern.replaceAll('\\', '/'), {
          onlyFiles: true,
          absolute: true,
        })
      ).sort()
    : [absolutePattern];
  const seen = new Set<string>();
  const resolved: SuiteImportStackEntry[] = [];
  for (const match of matches) {
    const identity = await canonicalEvalFileIdentity(match);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    resolved.push({
      identity,
      filePath: path.resolve(match),
      displayPath: displayEvalImportPath(path.resolve(match)),
    });
  }
  return resolved;
}

async function validateSuiteImportCycles(
  filePath: string,
  parsed: JsonObject,
  errors: ValidationError[],
): Promise<void> {
  const root: SuiteImportStackEntry = {
    identity: await canonicalEvalFileIdentity(filePath),
    filePath,
    displayPath: displayEvalImportPath(filePath),
  };
  await validateSuiteImportCyclesFromParsed(filePath, parsed, [root], errors);
}

async function validateSuiteImportCyclesFromParsed(
  currentFilePath: string,
  parsed: JsonObject,
  stack: readonly SuiteImportStackEntry[],
  errors: ValidationError[],
): Promise<void> {
  const tests = parsed.tests;
  if (!Array.isArray(tests)) {
    return;
  }

  for (let i = 0; i < tests.length; i++) {
    const entry = tests[i];
    if (!isObject(entry) || !isIncludeEntry(entry)) {
      continue;
    }
    const includePath = entry.include.trim();
    if (entry.type !== 'suite') {
      continue;
    }

    const location = `tests[${i}].include`;
    const resolvedSuites = await resolveSuiteIncludePaths(
      includePath,
      path.dirname(currentFilePath),
    );
    for (const resolvedSuite of resolvedSuites) {
      if (stack.some((ancestor) => ancestor.identity === resolvedSuite.identity)) {
        errors.push({
          severity: 'error',
          filePath: currentFilePath,
          location,
          message: `Circular eval suite import: ${formatCircularImportChain(stack, resolvedSuite)}`,
        });
        continue;
      }

      let childParsed: unknown;
      try {
        childParsed = interpolateEnv(
          parseYamlValue(await readFile(resolvedSuite.filePath, 'utf8')),
          process.env,
        );
      } catch {
        continue;
      }
      if (!isObject(childParsed)) {
        continue;
      }
      await validateSuiteImportCyclesFromParsed(
        resolvedSuite.filePath,
        childParsed,
        [...stack, resolvedSuite],
        errors,
      );
    }
  }
}

function validateAssertArray(
  assertField: JsonValue,
  parentLocation: string,
  filePath: string,
  errors: ValidationError[],
  customAssertionTypes: ReadonlySet<string> = new Set(),
): void {
  if (!Array.isArray(assertField)) {
    errors.push({
      severity: 'warning',
      filePath,
      location: `${parentLocation}.assertions`,
      message: "'assertions' must be an array of assertion objects.",
    });
    return;
  }

  // String items in the assertions array are valid shorthand — the parser collects them
  // into a single rubrics/llm-grader evaluator. Filter them out before object validation.
  const objectItems: { item: JsonObject; index: number }[] = [];
  for (let i = 0; i < assertField.length; i++) {
    const item = assertField[i];
    if (typeof item === 'string') {
      if (item.trim().length === 0) {
        errors.push({
          severity: 'warning',
          filePath,
          location: `${parentLocation}.assertions[${i}]`,
          message: 'Empty string assertion item will be ignored.',
        });
      }
      continue; // Valid shorthand — skip object validation
    }
    if (!isObject(item)) {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${parentLocation}.assertions[${i}]`,
        message: 'Assertion item must be a string or an object with a type field.',
      });
      continue;
    }
    objectItems.push({ item, index: i });
  }

  for (const { item, index } of objectItems) {
    const location = `${parentLocation}.assertions[${index}]`;

    // Validate type field
    const rawTypeValue = item.type;
    if (rawTypeValue === undefined || typeof rawTypeValue !== 'string') {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${location}.type`,
        message: "Assertion item is missing a 'type' field.",
      });
      continue;
    }

    // Normalize snake_case to kebab-case for backward compatibility
    const typeValue = rawTypeValue.replace(/_/g, '-');

    if (!isGraderKind(typeValue) && !customAssertionTypes.has(typeValue)) {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${location}.type`,
        message: `Unknown assertion type '${rawTypeValue}'.`,
      });
      continue;
    }

    // Validate value field for types that require a string value
    if (ASSERTION_TYPES_WITH_STRING_VALUE.has(typeValue)) {
      const value = item.value;
      if (value === undefined || typeof value !== 'string') {
        errors.push({
          severity: 'warning',
          filePath,
          location: `${location}.value`,
          message: `Assertion type '${typeValue}' requires a 'value' field (string).`,
        });
        continue;
      }

      // For regex type, validate that the pattern is valid
      if (typeValue === 'regex') {
        try {
          new RegExp(value);
        } catch {
          errors.push({
            severity: 'warning',
            filePath,
            location: `${location}.value`,
            message: `Invalid regex pattern '${value}': not a valid regular expression.`,
          });
        }
      }
    }

    // Validate value field for types that require a string array value
    if (ASSERTION_TYPES_WITH_ARRAY_VALUE.has(typeValue)) {
      const value = item.value;
      if (!Array.isArray(value) || value.length === 0) {
        errors.push({
          severity: 'warning',
          filePath,
          location: `${location}.value`,
          message: `Assertion type '${typeValue}' requires a 'value' field (non-empty string array).`,
        });
        continue;
      }
    }

    // Validate required field if present
    const required = item.required;
    if (required !== undefined) {
      validateRequiredField(required, location, filePath, errors);
    }
  }
}

function validateRequiredField(
  required: JsonValue,
  parentLocation: string,
  filePath: string,
  errors: ValidationError[],
): void {
  if (typeof required === 'boolean') {
    return; // Valid
  }
  if (typeof required === 'number') {
    if (required <= 0 || required > 1) {
      errors.push({
        severity: 'warning',
        filePath,
        location: `${parentLocation}.required`,
        message: `Invalid 'required' value ${required}. When a number, it must be between 0 (exclusive) and 1 (inclusive).`,
      });
    }
    return;
  }
  errors.push({
    severity: 'warning',
    filePath,
    location: `${parentLocation}.required`,
    message: `Invalid 'required' value. Must be a boolean or a number between 0 (exclusive) and 1 (inclusive).`,
  });
}

function validateContentForRoleMarkers(
  content: string,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  // Check for standard role markers that might confuse agentic providers
  const markers = ['@[System]:', '@[User]:', '@[Assistant]:', '@[Tool]:'];
  for (const marker of markers) {
    if (content.toLowerCase().includes(marker.toLowerCase())) {
      errors.push({
        severity: 'warning',
        filePath,
        location,
        message: `Content contains potential role marker '${marker}'. This may confuse agentic providers or cause prompt injection.`,
      });
    }
  }
}

/**
 * Cross-field validation for conversation mode fields.
 * Ensures consistency between mode, turns, aggregation, on_turn_failure, window_size.
 */
function validateConversationMode(
  evalCase: JsonObject,
  location: string,
  filePath: string,
  errors: ValidationError[],
): void {
  const mode = evalCase.mode;
  const turns = evalCase.turns;
  const aggregation = evalCase.aggregation;
  const onTurnFailure = evalCase.on_turn_failure;
  const windowSize = evalCase.window_size;

  const isConversationMode = mode === 'conversation';

  // turns present without mode: conversation
  if (turns !== undefined && !isConversationMode) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.turns`,
      message: "'turns' requires mode: conversation",
    });
  }

  // mode: conversation without turns or empty turns
  if (isConversationMode && (!Array.isArray(turns) || turns.length === 0)) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.mode`,
      message: "mode: conversation requires a non-empty 'turns' array",
    });
  }

  // turns + top-level expected_output
  if (isConversationMode && Array.isArray(turns) && evalCase.expected_output !== undefined) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.expected_output`,
      message:
        "Top-level 'expected_output' is not allowed with mode: conversation (use per-turn expected_output instead)",
    });
  }

  // aggregation without mode: conversation
  if (aggregation !== undefined && !isConversationMode) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.aggregation`,
      message: "'aggregation' requires mode: conversation",
    });
  }

  // on_turn_failure without mode: conversation
  if (onTurnFailure !== undefined && !isConversationMode) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.on_turn_failure`,
      message: "'on_turn_failure' requires mode: conversation",
    });
  }

  // window_size without mode: conversation
  if (windowSize !== undefined && !isConversationMode) {
    errors.push({
      severity: 'error',
      filePath,
      location: `${location}.window_size`,
      message: "'window_size' requires mode: conversation",
    });
  }

  // Validate each turn has non-empty input
  if (isConversationMode && Array.isArray(turns)) {
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (!isObject(turn)) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.turns[${i}]`,
          message: 'Turn must be an object',
        });
        continue;
      }
      const turnInput = turn.input;
      const isEmpty =
        turnInput === undefined ||
        turnInput === '' ||
        (typeof turnInput === 'string' && turnInput.trim() === '') ||
        (Array.isArray(turnInput) && turnInput.length === 0);
      if (isEmpty) {
        errors.push({
          severity: 'error',
          filePath,
          location: `${location}.turns[${i}].input`,
          message: 'Each turn must have a non-empty input',
        });
      }
    }
  }
}
