import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

type JsonObject = Record<string, unknown>;

const ROOTS = [
  'examples',
  'evals',
  'apps/cli/src/templates',
  'apps/cli/test/commands/eval/pipeline/fixtures',
];
const INPUT_PROMPT = '{{ input }}';
const EXPECTED_OUTPUT_VAR = 'expected_output';
const REFERENCE_MATCH_ASSERTION = {
  type: 'llm-rubric',
  value: 'Matches the reference answer: {{ expected_output }}',
};
const LEGACY_ENV_PATTERN = /\$\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g;
const PREPROCESSOR_MEDIA_TYPES: Readonly<Record<string, readonly string[]>> = {
  xlsx: ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
};
const TEST_TS_FILES = [
  'apps/cli/test/commands/eval/artifact-writer.test.ts',
  'apps/cli/test/commands/eval/bundle.test.ts',
  'apps/cli/test/commands/eval/shared.test.ts',
  'apps/cli/test/commands/eval/targets.test.ts',
  'apps/cli/test/commands/eval/task-bundle.test.ts',
  'apps/cli/test/commands/grade/grade-prepared.test.ts',
  'apps/cli/test/commands/prepare/prepare.test.ts',
  'apps/cli/test/commands/runs/rerun.test.ts',
  'apps/cli/test/commands/workspace/deps.test.ts',
  'apps/cli/test/eval.integration.test.ts',
  'packages/core/test/evaluation/conversation-mode.test.ts',
  'packages/core/test/evaluation/criteria-optional.test.ts',
  'packages/core/test/evaluation/extensions.test.ts',
  'packages/core/test/evaluation/interpolation-integration.test.ts',
  'packages/core/test/evaluation/repo-schema-validation.test.ts',
  'packages/core/test/evaluation/rubric-operators-yaml.test.ts',
  'packages/core/test/evaluation/source-traceability.test.ts',
  'packages/core/test/evaluation/yaml-parser-tags-map.test.ts',
  'packages/core/test/evaluation/loaders/ts-eval-loader.test.ts',
  'packages/core/test/evaluation/loaders/case-file-loader.test.ts',
  'packages/core/test/evaluation/loaders/jsonl-parser.test.ts',
  'packages/core/test/evaluation/suite-level-input.test.ts',
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (!['node_modules', 'dist', '.beads'].includes(entry)) {
        walk(fullPath, files);
      }
    } else if (/\.(ya?ml)$/i.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function migrateLegacyEnvReference(value: string): string {
  return value.replace(LEGACY_ENV_PATTERN, (_match, name: string) => `{{ env.${name} }}`);
}

function setNestedObjectValue(parent: JsonObject, key: string, value: unknown): void {
  const child = isObject(parent[key]) ? parent[key] : {};
  parent[key] = child;
  Object.assign(child, value);
}

function migrateExecutionConcurrency(suite: JsonObject): boolean {
  if (!isObject(suite.execution)) return false;

  const execution = suite.execution;
  const concurrency = execution.max_concurrency ?? execution.workers;
  let changed = false;
  if (concurrency !== undefined) {
    const evaluateOptions = isObject(suite.evaluate_options) ? suite.evaluate_options : {};
    if (evaluateOptions.max_concurrency === undefined) {
      evaluateOptions.max_concurrency = clone(concurrency);
      suite.evaluate_options = evaluateOptions;
    }
    Reflect.deleteProperty(execution, 'max_concurrency');
    Reflect.deleteProperty(execution, 'workers');
    changed = true;
  }

  if (Object.keys(execution).length === 0) {
    Reflect.deleteProperty(suite, 'execution');
    changed = true;
  }
  return changed;
}

function transformWrapperForPreprocessors(preprocessors: unknown): string | undefined {
  if (!Array.isArray(preprocessors) || preprocessors.length !== 1) return undefined;
  const preprocessor = preprocessors[0];
  if (!isObject(preprocessor)) return undefined;
  const rawType = typeof preprocessor.type === 'string' ? preprocessor.type : undefined;
  const rawCommand = preprocessor.command;
  const command =
    typeof rawCommand === 'string'
      ? [rawCommand]
      : Array.isArray(rawCommand) && rawCommand.every((entry) => typeof entry === 'string')
        ? rawCommand
        : undefined;
  if (!rawType || !command || command.length === 0) return undefined;

  const matchers = PREPROCESSOR_MEDIA_TYPES[rawType] ?? [rawType];
  const commandLiteral = JSON.stringify(command);
  const matcherLiteral = JSON.stringify(matchers);
  return `return (() => {
  const content = Array.isArray(output) ? output : [];
  const matchers = ${matcherLiteral};
  const file = content.find((block) => {
    if (!block || block.type !== "file") return false;
    const mediaType = typeof block.media_type === "string" ? block.media_type : "";
    const filePath = typeof block.path === "string" ? block.path : "";
    return matchers.some((matcher) => mediaType === matcher || filePath.endsWith(matcher));
  });
  if (!file || typeof file.path !== "string") return output;
  const result = Bun.spawnSync(${commandLiteral}, {
    stdin: JSON.stringify({ path: file.path, media_type: file.media_type })
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || "preprocessor command failed");
  }
  return new TextDecoder().decode(result.stdout).trim();
})()`;
}

function migrateOptionsPostprocess(options: unknown): boolean {
  if (!isObject(options) || options.postprocess === undefined) return false;
  if (options.transform === undefined) {
    options.transform = clone(options.postprocess);
  }
  Reflect.deleteProperty(options, 'postprocess');
  return true;
}

function migrateAssertionTransform(assertion: JsonObject): boolean {
  let changed = false;
  if (assertion.postprocess !== undefined) {
    if (assertion.transform === undefined) {
      assertion.transform = clone(assertion.postprocess);
    }
    Reflect.deleteProperty(assertion, 'postprocess');
    changed = true;
  }
  if (assertion.preprocessors !== undefined) {
    const transform = transformWrapperForPreprocessors(assertion.preprocessors);
    if (transform && assertion.transform === undefined) {
      assertion.transform = transform;
    }
    Reflect.deleteProperty(assertion, 'preprocessors');
    changed = true;
  }
  return changed;
}

function argsMatchMode(value: unknown): 'partial' | 'exact' {
  return value === 'exact' ? 'exact' : 'partial';
}

function hasLatencyTrajectoryCheck(assertion: JsonObject): boolean {
  return (
    Array.isArray(assertion.expected) &&
    assertion.expected.some(
      (item) =>
        isObject(item) && (item.max_duration_ms !== undefined || item.maxDurationMs !== undefined),
    )
  );
}

function normalizedAssertionType(assertion: JsonObject): string | undefined {
  return typeof assertion.type === 'string' ? assertion.type.replace(/_/g, '-') : undefined;
}

function migrateSkillTriggerAssertion(assertion: JsonObject): boolean {
  if (
    normalizedAssertionType(assertion) !== 'skill-trigger' ||
    typeof assertion.skill !== 'string'
  ) {
    return false;
  }

  assertion.type = assertion.should_trigger === false ? 'not-skill-used' : 'skill-used';
  assertion.value = assertion.skill;
  Reflect.deleteProperty(assertion, 'skill');
  Reflect.deleteProperty(assertion, 'should_trigger');
  return true;
}

function migrateAnyOrderToolTrajectory(assertion: JsonObject): JsonObject[] | undefined {
  if (assertion.mode !== 'any_order' || !isObject(assertion.minimums)) return undefined;

  return Object.entries(assertion.minimums)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= 0)
    .map(([name, min], index) => ({
      ...clone(assertion),
      ...(index === 0 ? {} : { metric: undefined }),
      type: 'trajectory:tool-used',
      value: { name, min },
      mode: undefined,
      minimums: undefined,
      expected: undefined,
      args_match: undefined,
      argsMatch: undefined,
    }))
    .map((entry) => {
      for (const key of Object.keys(entry)) {
        if (entry[key] === undefined) Reflect.deleteProperty(entry, key);
      }
      return entry;
    });
}

function migrateExpectedToolTrajectory(assertion: JsonObject): JsonObject[] | undefined {
  if (
    assertion.mode !== 'in_order' &&
    assertion.mode !== 'exact' &&
    assertion.mode !== 'subset' &&
    assertion.mode !== 'superset'
  ) {
    return undefined;
  }
  if (assertion.mode === 'subset' || assertion.mode === 'superset') return undefined;
  if (!Array.isArray(assertion.expected)) return undefined;

  const expected = assertion.expected.filter(isObject);
  const steps = expected
    .map((item) => item.tool)
    .filter((tool): tool is string => typeof tool === 'string' && tool.length > 0);
  if (steps.length === 0) return undefined;

  const mode = assertion.mode;
  const sequenceAssertion: JsonObject = {
    ...clone(assertion),
    type: 'trajectory:tool-sequence',
    value: { mode, steps },
  };
  for (const key of ['mode', 'minimums', 'expected', 'args_match', 'argsMatch']) {
    Reflect.deleteProperty(sequenceAssertion, key);
  }

  const argsMode = argsMatchMode(assertion.args_match ?? assertion.argsMatch);
  const argsAssertions = expected
    .filter(
      (item) => typeof item.tool === 'string' && item.args !== undefined && item.args !== 'any',
    )
    .map((item) => ({
      type: 'trajectory:tool-args-match',
      value: {
        name: item.tool,
        args: clone(item.args),
        mode: argsMatchMode(item.args_match ?? item.argsMatch ?? argsMode),
      },
    }));

  return [sequenceAssertion, ...argsAssertions];
}

function migrateToolTrajectoryAssertion(assertion: JsonObject): JsonObject[] | undefined {
  if (
    normalizedAssertionType(assertion) !== 'tool-trajectory' ||
    hasLatencyTrajectoryCheck(assertion)
  ) {
    return undefined;
  }
  return migrateAnyOrderToolTrajectory(assertion) ?? migrateExpectedToolTrajectory(assertion);
}

function migrateAssertions(assertions: unknown): boolean {
  if (!Array.isArray(assertions)) return false;
  let changed = false;
  for (let index = 0; index < assertions.length; index++) {
    const assertion = assertions[index];
    if (!isObject(assertion)) continue;

    changed = migrateAssertions(assertion.assert) || changed;
    changed = migrateAssertionTransform(assertion) || changed;
    changed = migrateSkillTriggerAssertion(assertion) || changed;

    const replacements = migrateToolTrajectoryAssertion(assertion);
    if (replacements && replacements.length > 0) {
      assertions.splice(index, 1, ...replacements);
      index += replacements.length - 1;
      changed = true;
    }
  }
  return changed;
}

function migrateSuitePreprocessors(suite: JsonObject): boolean {
  if (suite.preprocessors === undefined) return false;
  const transform = transformWrapperForPreprocessors(suite.preprocessors);
  if (transform) {
    const defaultTest = isObject(suite.default_test) ? suite.default_test : {};
    suite.default_test = defaultTest;
    setNestedObjectValue(defaultTest, 'options', {
      ...(isObject(defaultTest.options) ? defaultTest.options : {}),
      ...(isObject(defaultTest.options) && defaultTest.options.transform !== undefined
        ? {}
        : { transform }),
    });
  }
  Reflect.deleteProperty(suite, 'preprocessors');
  return true;
}

function migrateWorkspace(workspace: unknown): boolean {
  if (!isObject(workspace)) return false;
  if (workspace.isolation === undefined && workspace.mode === undefined) return false;

  const raw = workspace.isolation ?? workspace.mode;
  if (workspace.scope === undefined) {
    if (raw === 'shared' || raw === 'suite') {
      workspace.scope = 'suite';
    } else if (raw === 'per_case' || raw === 'per_test' || raw === 'attempt' || raw === 'fresh') {
      workspace.scope = 'attempt';
    }
  }
  Reflect.deleteProperty(workspace, 'isolation');
  Reflect.deleteProperty(workspace, 'mode');
  return true;
}

function migrateDeprecatedArtifactKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.map(migrateDeprecatedArtifactKeys).some(Boolean);
  }
  if (!isObject(value)) return false;

  let changed = false;
  for (const nested of Object.values(value)) {
    changed = migrateDeprecatedArtifactKeys(nested) || changed;
  }
  if (Object.hasOwn(value, 'timing_path')) {
    if (value.metrics_path === undefined) {
      value.metrics_path =
        typeof value.timing_path === 'string'
          ? value.timing_path.replace(/timing\.json/g, 'metrics.json')
          : clone(value.timing_path);
    }
    Reflect.deleteProperty(value, 'timing_path');
    changed = true;
  }
  if (Object.hasOwn(value, 'manifest_path')) {
    if (value.index_path === undefined) {
      value.index_path = migrateManifestPathToIndexPath(value.manifest_path);
    }
    Reflect.deleteProperty(value, 'manifest_path');
    changed = true;
  }
  return changed;
}

function migrateManifestPathToIndexPath(value: unknown): unknown {
  if (typeof value !== 'string') {
    return clone(value);
  }
  return value.replace(/manifest\.jsonl?$/i, 'index.jsonl');
}

function migrateLegacyEnvReferences(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (typeof entry === 'string') {
          const next = migrateLegacyEnvReference(entry);
          if (next !== entry) {
            value[index] = next;
            return true;
          }
          return false;
        }
        return migrateLegacyEnvReferences(entry);
      })
      .some(Boolean);
  }
  if (!isObject(value)) return false;

  let changed = false;
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string') {
      const next = migrateLegacyEnvReference(nested);
      if (next !== nested) {
        value[key] = next;
        changed = true;
      }
    } else {
      changed = migrateLegacyEnvReferences(nested) || changed;
    }
  }
  return changed;
}

function inputFilesToMessage(
  inputFiles: unknown,
  input: unknown,
  fileDir: string,
): unknown | undefined {
  if (!Array.isArray(inputFiles)) return input;
  const files = inputFiles.filter((value): value is string => typeof value === 'string');
  if (files.length === 0) return input;

  if (typeof input === 'string') {
    return [
      {
        role: 'user',
        content: [
          ...files.map((value) => ({ type: 'file', value })),
          { type: 'text', value: input },
        ],
      },
    ];
  }

  if (input !== undefined) {
    return [
      {
        role: 'user',
        content: files.map((value) => ({ type: 'file', value })),
      },
      ...toMessages(input),
    ];
  }

  const promptIndex = files.findIndex((value) => path.basename(value) === 'PROMPT.md');
  const promptText =
    promptIndex >= 0
      ? readFileSync(path.resolve(fileDir, files[promptIndex] as string), 'utf8').trim()
      : undefined;
  const attachedFiles = files.filter((_, index) => index !== promptIndex);
  return [
    {
      role: 'user',
      content: [
        ...attachedFiles.map((value) => ({ type: 'file', value })),
        ...(promptText ? [{ type: 'text', value: promptText }] : []),
      ],
    },
  ];
}

function toMessages(input: unknown): unknown[] {
  if (Array.isArray(input)) return clone(input);
  if (isObject(input) && typeof input.role === 'string') return [clone(input)];
  return [{ role: 'user', content: clone(input) }];
}

function combineInputs(
  prefix: unknown | undefined,
  current: unknown | undefined,
): unknown | undefined {
  if (prefix === undefined) return current;
  if (current === undefined) return prefix;
  return [...toMessages(prefix), ...toMessages(current)];
}

function hasSkipDefaults(testCase: JsonObject): boolean {
  return isObject(testCase.execution) && testCase.execution.skip_defaults === true;
}

function setVarsInput(testCase: JsonObject, input: unknown): void {
  const vars = isObject(testCase.vars) ? testCase.vars : {};
  vars.input = input;
  testCase.vars = vars;
}

function setVarsExpectedOutput(testCase: JsonObject, expectedOutput: unknown): void {
  const vars = isObject(testCase.vars) ? testCase.vars : {};
  vars[EXPECTED_OUTPUT_VAR] = expectedOutput;
  testCase.vars = vars;
}

function hasExplicitAssertStrategy(value: JsonObject): boolean {
  return (
    Object.hasOwn(value, 'assert') ||
    (typeof value.criteria === 'string' && value.criteria.trim().length > 0) ||
    (typeof value.expected_outcome === 'string' && value.expected_outcome.trim().length > 0)
  );
}

function addReferenceAssertion(value: JsonObject): void {
  value.assert = [clone(REFERENCE_MATCH_ASSERTION)];
}

function migrateExpectedOutput(value: JsonObject, hasInheritedAssertStrategy: boolean): boolean {
  if (!Object.hasOwn(value, 'expected_output')) return false;
  const hadExplicitAssertStrategy = hasExplicitAssertStrategy(value) || hasInheritedAssertStrategy;
  setVarsExpectedOutput(value, value.expected_output);
  Reflect.deleteProperty(value, 'expected_output');
  if (!hadExplicitAssertStrategy) {
    addReferenceAssertion(value);
  }
  return true;
}

function migrateCase(
  testCase: JsonObject,
  fileDir: string,
  suiteInput?: unknown,
  hasInheritedAssertStrategy = false,
): boolean {
  let changed = migrateExpectedOutput(testCase, hasInheritedAssertStrategy);
  const hasCaseInput = Object.hasOwn(testCase, 'input');
  const hasCaseInputFiles = Object.hasOwn(testCase, 'input_files');
  const effectiveSuiteInput = hasSkipDefaults(testCase) ? undefined : suiteInput;
  if (!hasCaseInput && !hasCaseInputFiles && effectiveSuiteInput === undefined) {
    return changed;
  }

  const caseInput = hasCaseInputFiles
    ? inputFilesToMessage(testCase.input_files, testCase.input, fileDir)
    : testCase.input;
  const migratedInput = combineInputs(effectiveSuiteInput, caseInput);
  if (migratedInput !== undefined) {
    setVarsInput(testCase, migratedInput);
  }
  Reflect.deleteProperty(testCase, 'input');
  Reflect.deleteProperty(testCase, 'input_files');
  changed = true;
  return changed;
}

function ensureDefaultTest(suite: JsonObject): JsonObject {
  if (isObject(suite.default_test)) return suite.default_test;
  const defaultTest: JsonObject = {};
  suite.default_test = defaultTest;
  return defaultTest;
}

function migrateSuiteExpectedOutput(
  suite: JsonObject,
  hasInheritedAssertStrategy: boolean,
): boolean {
  if (!Object.hasOwn(suite, 'expected_output')) return false;
  const defaultTest = ensureDefaultTest(suite);
  const hadExplicitAssertStrategy =
    hasExplicitAssertStrategy(defaultTest) ||
    hasExplicitAssertStrategy(suite) ||
    hasInheritedAssertStrategy;
  setVarsExpectedOutput(defaultTest, suite.expected_output);
  Reflect.deleteProperty(suite, 'expected_output');
  if (!hadExplicitAssertStrategy) {
    addReferenceAssertion(defaultTest);
  }
  return true;
}

function migrateDefaultTestExpectedOutput(suite: JsonObject): boolean {
  if (!isObject(suite.default_test) || !Object.hasOwn(suite.default_test, 'expected_output')) {
    return false;
  }
  const defaultTest = suite.default_test;
  const hadExplicitAssertStrategy =
    hasExplicitAssertStrategy(defaultTest) || hasExplicitAssertStrategy(suite);
  setVarsExpectedOutput(defaultTest, defaultTest.expected_output);
  Reflect.deleteProperty(defaultTest, 'expected_output');
  if (!hadExplicitAssertStrategy) {
    addReferenceAssertion(defaultTest);
  }
  return true;
}

function ensurePrompt(suite: JsonObject): void {
  if (suite.prompts !== undefined) return;
  const rebuilt: JsonObject = {};
  let inserted = false;
  for (const [key, value] of Object.entries(suite)) {
    if (!inserted && (key === 'default_test' || key === 'imports' || key === 'tests')) {
      rebuilt.prompts = [INPUT_PROMPT];
      inserted = true;
    }
    rebuilt[key] = value;
  }
  if (!inserted) rebuilt.prompts = [INPUT_PROMPT];
  for (const key of Object.keys(suite)) delete suite[key];
  Object.assign(suite, rebuilt);
}

function resolveCasePath(filePath: string, rawPath: string): string | undefined {
  const cleaned = rawPath.startsWith('file://') ? rawPath.slice('file://'.length) : rawPath;
  if (/^[a-z]+:\/\//i.test(cleaned)) return undefined;
  return path.resolve(path.dirname(filePath), cleaned);
}

function migrateJsonlFile(filePath: string, suiteInput?: unknown): boolean {
  if (!existsSync(filePath)) return false;
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  let changed = false;
  const migrated = lines.map((line) => {
    if (line.trim() === '') return line;
    const parsed = JSON.parse(line) as unknown;
    if (!isObject(parsed)) return line;
    if (migrateCase(parsed, path.dirname(filePath), suiteInput)) {
      changed = true;
      return JSON.stringify(parsed);
    }
    return line;
  });
  if (changed) writeFileSync(filePath, `${migrated.join('\n').replace(/\n*$/, '')}\n`);
  return changed;
}

function migrateCsvFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf8');
  const [header, ...rest] = content.split(/\r?\n/);
  if (!header) return false;
  const columns = header.split(',');
  const inputIndex = columns.indexOf('input');
  if (inputIndex < 0) return false;
  columns[inputIndex] = 'vars.input';
  writeFileSync(filePath, `${[columns.join(','), ...rest].join('\n').replace(/\n*$/, '')}\n`);
  return true;
}

function migrateExternalCaseFile(
  rawPath: string,
  parentPath: string,
  suiteInput?: unknown,
): boolean {
  const resolvedPath = resolveCasePath(parentPath, rawPath);
  if (!resolvedPath || !existsSync(resolvedPath)) return false;
  if (/\.jsonl$/i.test(resolvedPath)) return migrateJsonlFile(resolvedPath, suiteInput);
  if (/\.csv$/i.test(resolvedPath)) return migrateCsvFile(resolvedPath);
  if (/\.ya?ml$/i.test(resolvedPath)) return migrateYamlFile(resolvedPath, suiteInput);
  return false;
}

function migrateImports(imports: unknown, filePath: string, suiteInput?: unknown): boolean {
  if (!isObject(imports)) return false;
  const rawTests = imports.tests;
  const entries = Array.isArray(rawTests) ? rawTests : rawTests !== undefined ? [rawTests] : [];
  let changed = false;
  for (const entry of entries) {
    if (typeof entry === 'string') {
      changed = migrateExternalCaseFile(entry, filePath, suiteInput) || changed;
    } else if (isObject(entry) && typeof entry.path === 'string') {
      changed = migrateExternalCaseFile(entry.path, filePath, suiteInput) || changed;
    }
  }
  return changed;
}

function migrateYamlValue(
  value: unknown,
  filePath: string,
  inheritedSuiteInput?: unknown,
): boolean {
  const fileDir = path.dirname(filePath);
  if (Array.isArray(value)) {
    return value
      .filter(isObject)
      .map((testCase) => migrateCase(testCase, fileDir, inheritedSuiteInput))
      .some(Boolean);
  }

  if (!isObject(value)) return false;

  let changed = false;
  changed = migrateLegacyEnvReferences(value) || changed;
  changed = migrateDeprecatedArtifactKeys(value) || changed;
  changed = migrateExecutionConcurrency(value) || changed;
  changed = migrateWorkspace(value.workspace) || changed;
  changed =
    migrateOptionsPostprocess(
      isObject(value.default_test) ? value.default_test.options : undefined,
    ) || changed;
  changed = migrateSuitePreprocessors(value) || changed;
  changed = migrateAssertions(value.assert) || changed;

  const isSuiteLike =
    value.tests !== undefined || value.eval_cases !== undefined || value.imports !== undefined;
  changed = migrateSuiteExpectedOutput(value, false) || changed;
  changed = migrateDefaultTestExpectedOutput(value) || changed;
  if (!isSuiteLike && inheritedSuiteInput === undefined) {
    return changed;
  }

  const hasSuiteInput = Object.hasOwn(value, 'input') || Object.hasOwn(value, 'input_files');
  const suiteInput = hasSuiteInput
    ? inputFilesToMessage(value.input_files, value.input, fileDir)
    : inheritedSuiteInput;

  const rawTests = value.tests ?? value.eval_cases;
  const hasSuiteAssertStrategy =
    hasExplicitAssertStrategy(value) ||
    (isObject(value.default_test) && hasExplicitAssertStrategy(value.default_test));
  if (Array.isArray(rawTests)) {
    for (const entry of rawTests) {
      if (isObject(entry) && !Object.hasOwn(entry, 'include')) {
        changed = migrateWorkspace(entry.workspace) || changed;
        changed = migrateOptionsPostprocess(entry.options) || changed;
        changed = migrateAssertions(entry.assert) || changed;
        changed = migrateCase(entry, fileDir, suiteInput, hasSuiteAssertStrategy) || changed;
      }
    }
  } else if (typeof rawTests === 'string') {
    changed = migrateExternalCaseFile(rawTests, filePath, suiteInput) || changed;
  }

  changed = migrateImports(value.imports, filePath, suiteInput) || changed;

  if (hasSuiteInput) {
    Reflect.deleteProperty(value, 'input');
    Reflect.deleteProperty(value, 'input_files');
    changed = true;
  }

  if (changed && isSuiteLike) {
    ensurePrompt(value);
  }
  return changed;
}

function migrateYamlFile(filePath: string, inheritedSuiteInput?: unknown): boolean {
  const source = readFileSync(filePath, 'utf8');
  const parsed = parse(source, { uniqueKeys: false }) as unknown;
  const changed = migrateYamlValue(parsed, filePath, inheritedSuiteInput);
  if (!changed) return false;
  writeFileSync(
    filePath,
    stringify(parsed, { lineWidth: 100, singleQuote: false }).replace(/\n*$/, '\n'),
  );
  return true;
}

function migrateYamlSnippet(source: string, filePath: string): string | undefined {
  if (
    !source.includes('input:') &&
    !source.includes('input_files:') &&
    !source.includes('expected_output:') &&
    !source.includes('${{') &&
    !source.includes('execution:') &&
    !source.includes('preprocessors:') &&
    !source.includes('postprocess:') &&
    !source.includes('timing_path:') &&
    !source.includes('manifest_path:') &&
    !source.includes('isolation:') &&
    !source.includes('skill-trigger') &&
    !source.includes('skill_trigger') &&
    !source.includes('tool-trajectory') &&
    !source.includes('tool_trajectory')
  ) {
    return undefined;
  }
  if (source.replace(LEGACY_ENV_PATTERN, '').includes('${')) return undefined;
  try {
    const parsed = parse(source, { uniqueKeys: false }) as unknown;
    if (Array.isArray(parsed)) {
      return undefined;
    }
    if (isObject(parsed) && parsed.prompts !== undefined) {
      const tests = parsed.tests ?? parsed.eval_cases;
      if (
        parsed.input !== undefined ||
        (Array.isArray(tests) &&
          tests.some((entry) => isObject(entry) && entry.input !== undefined))
      ) {
        return undefined;
      }
    }
    if (!migrateYamlValue(parsed, filePath)) return undefined;
    return stringify(parsed, { lineWidth: 100, singleQuote: false }).replace(/\n*$/, '\n');
  } catch {
    return undefined;
  }
}

function quoteTsLine(line: string): string {
  return `'${line.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function migrateJoinedLineArrays(source: string, filePath: string): string {
  return source.replace(/\[((?:\s*'[^']*',?)+\s*)\]\.join\('\\n'\)/g, (match, body: string) => {
    const lines: string[] = [];
    for (const lineMatch of body.matchAll(/'([^']*)'/g)) {
      lines.push(lineMatch[1] as string);
    }
    const migrated = migrateYamlSnippet(lines.join('\n'), filePath);
    if (migrated === undefined) return match;
    const migratedLines = migrated.replace(/\n$/, '').split('\n');
    return `[${migratedLines.map(quoteTsLine).join(', ')}].join('\\n')`;
  });
}

function migrateTestTemplateLiterals(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const source = readFileSync(filePath, 'utf8');
  let changed = false;
  const withTemplateLiterals = source.replace(/`([\s\S]*?)`/g, (match, body: string) => {
    const migrated = migrateYamlSnippet(body, filePath);
    if (migrated === undefined) return match;
    changed = true;
    return `\`${migrated}\``;
  });
  const next = migrateJoinedLineArrays(withTemplateLiterals, filePath);
  if (next !== withTemplateLiterals) changed = true;
  if (changed) writeFileSync(filePath, next);
  return changed;
}

export function migrateRepository(): number {
  let changedCount = 0;
  for (const root of ROOTS) {
    for (const filePath of walk(root)) {
      if (migrateYamlFile(filePath)) changedCount += 1;
    }
  }
  for (const filePath of TEST_TS_FILES) {
    if (migrateTestTemplateLiterals(filePath)) changedCount += 1;
  }
  return changedCount;
}

export const _internal = {
  migrateYamlSnippet,
  migrateYamlValue,
  transformWrapperForPreprocessors,
};

if (import.meta.main) {
  console.log(`Migrated ${migrateRepository()} YAML roots`);
}
