import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

type JsonObject = Record<string, unknown>;

const ROOTS = ['examples', 'evals', 'apps/cli/test/commands/eval/pipeline/fixtures'];
const INPUT_PROMPT = '{{ input }}';
const TEST_TS_FILES = [
  'apps/cli/test/commands/eval/artifact-writer.test.ts',
  'apps/cli/test/commands/eval/bundle.test.ts',
  'apps/cli/test/commands/eval/shared.test.ts',
  'apps/cli/test/commands/eval/targets.test.ts',
  'apps/cli/test/commands/eval/task-bundle.test.ts',
  'apps/cli/test/commands/grade/grade-prepared.test.ts',
  'apps/cli/test/commands/prepare/prepare.test.ts',
  'apps/cli/test/commands/workspace/deps.test.ts',
  'apps/cli/test/eval.integration.test.ts',
  'packages/core/test/evaluation/conversation-mode.test.ts',
  'packages/core/test/evaluation/criteria-optional.test.ts',
  'packages/core/test/evaluation/extensions.test.ts',
  'packages/core/test/evaluation/interpolation-integration.test.ts',
  'packages/core/test/evaluation/preprocessors-yaml.test.ts',
  'packages/core/test/evaluation/repo-schema-validation.test.ts',
  'packages/core/test/evaluation/rubric-operators-yaml.test.ts',
  'packages/core/test/evaluation/source-traceability.test.ts',
  'packages/core/test/evaluation/workspace-config-parsing.test.ts',
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
      if (!['node_modules', 'dist', '.agentv', '.beads'].includes(entry)) {
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

function migrateCase(testCase: JsonObject, fileDir: string, suiteInput?: unknown): boolean {
  const hasCaseInput = Object.hasOwn(testCase, 'input');
  const hasCaseInputFiles = Object.hasOwn(testCase, 'input_files');
  const effectiveSuiteInput = hasSkipDefaults(testCase) ? undefined : suiteInput;
  if (!hasCaseInput && !hasCaseInputFiles && effectiveSuiteInput === undefined) {
    return false;
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

  const isSuiteLike =
    value.tests !== undefined || value.eval_cases !== undefined || value.imports !== undefined;
  if (!isSuiteLike && inheritedSuiteInput === undefined) {
    return false;
  }

  const hasSuiteInput = Object.hasOwn(value, 'input') || Object.hasOwn(value, 'input_files');
  const suiteInput = hasSuiteInput
    ? inputFilesToMessage(value.input_files, value.input, fileDir)
    : inheritedSuiteInput;

  let changed = false;
  const rawTests = value.tests ?? value.eval_cases;
  if (Array.isArray(rawTests)) {
    for (const entry of rawTests) {
      if (isObject(entry) && !Object.hasOwn(entry, 'include')) {
        changed = migrateCase(entry, fileDir, suiteInput) || changed;
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
  if (!source.includes('input:') && !source.includes('input_files:')) return undefined;
  if (source.includes('${')) return undefined;
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

let changedCount = 0;
for (const root of ROOTS) {
  for (const filePath of walk(root)) {
    if (migrateYamlFile(filePath)) changedCount += 1;
  }
}
for (const filePath of TEST_TS_FILES) {
  if (migrateTestTemplateLiterals(filePath)) changedCount += 1;
}

console.log(`Migrated ${changedCount} YAML roots`);
