import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { command, flag, option, optional, positional, string } from 'cmd-ts';
import fg from 'fast-glob';
import JSON5 from 'json5';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const FILE_PREFIX = 'file://';
const PROMPTFOO_COMMENT_PREFIX = '# Converted from promptfoo config: ';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, unknown>;

type AgentvInput =
  | string
  | Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
    }>;

interface PromptfooConfig {
  description?: string;
  prompts?: unknown;
  providers?: unknown;
  targets?: unknown;
  tests?: unknown;
  defaultTest?: unknown;
}

interface PromptfooPrompt {
  readonly key: string;
  readonly label: string;
  readonly source: string;
  readonly content: AgentvInput;
}

interface PromptfooProvider {
  readonly id: string;
  readonly label?: string;
  readonly targetName: string;
}

interface PromptfooTestCase {
  id?: string;
  description?: string;
  vars?: unknown;
  assert?: unknown;
  prompts?: unknown;
  providers?: unknown;
  provider?: unknown;
  threshold?: unknown;
  metadata?: unknown;
  options?: unknown;
  providerOutput?: unknown;
  [key: string]: unknown;
}

interface PromptfooTestOptions {
  readonly disableDefaultAsserts?: boolean;
  readonly disableVarExpansion?: boolean;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly transform?: string;
  readonly transformVars?: string;
}

interface AgentvAssertion {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface AgentvTest {
  readonly id: string;
  readonly input: AgentvInput;
  readonly vars?: Record<string, JsonValue>;
  readonly assertions?: readonly AgentvAssertion[];
  readonly [key: string]: unknown;
}

interface AgentvSuite {
  readonly name: string;
  readonly description?: string;
  readonly execution?: Record<string, unknown>;
  readonly assertions?: readonly AgentvAssertion[];
  readonly tests: readonly AgentvTest[];
  readonly [key: string]: unknown;
}

interface ConvertPromptfooOptions {
  readonly inputPath: string;
}

export async function convertPromptfooToAgentvSuite(
  options: ConvertPromptfooOptions,
): Promise<AgentvSuite> {
  const absoluteInputPath = path.resolve(options.inputPath);
  const configDir = path.dirname(absoluteInputPath);
  const rawConfig = await loadPromptfooConfig(absoluteInputPath);

  const suiteName = sanitizeName(path.basename(absoluteInputPath, path.extname(absoluteInputPath)));
  const prompts = await loadPromptfooPrompts(rawConfig.prompts, configDir);
  if (prompts.length === 0) {
    throw new Error(`promptfoo import requires at least one prompt in ${absoluteInputPath}`);
  }

  const providers = await loadPromptfooProviders(
    rawConfig.providers ?? rawConfig.targets,
    configDir,
  );
  const defaultTest = await loadDefaultTest(rawConfig.defaultTest, configDir);
  const testCases = await loadPromptfooTests(rawConfig.tests, configDir);

  const defaultAssertions = await convertPromptfooAssertions(
    readAssertionList(defaultTest.assert),
    absoluteInputPath,
  );
  const suiteTargetNames =
    filterProviders(providers, defaultTest.providers ?? defaultTest.provider) ??
    providers.map((provider) => provider.targetName);
  const convertedTests = await buildAgentvTests({
    inputPath: absoluteInputPath,
    prompts,
    defaultTest,
    rawTests: testCases,
    suiteTargetNames,
  });

  const execution: Record<string, unknown> = {};
  if (suiteTargetNames.length > 0) {
    execution.targets = suiteTargetNames;
  }

  const suite: AgentvSuite = {
    name: suiteName,
    ...(typeof rawConfig.description === 'string' ? { description: rawConfig.description } : {}),
    ...(Object.keys(execution).length > 0 ? { execution } : {}),
    ...(defaultAssertions.length > 0 ? { assertions: defaultAssertions } : {}),
    tests: convertedTests,
  };

  return suite;
}

export async function convertPromptfooToAgentvYaml(inputPath: string): Promise<string> {
  const suite = await convertPromptfooToAgentvSuite({ inputPath });
  const yaml = stringifyYaml(suite, {
    indent: 2,
    lineWidth: 0,
  });
  return `${PROMPTFOO_COMMENT_PREFIX}${path.resolve(inputPath)}\n${yaml}`;
}

export const importPromptfooCommand = command({
  name: 'promptfoo',
  description: 'Import a promptfoo config into an AgentV EVAL.yaml',
  args: {
    input: positional({
      type: string,
      displayName: 'input',
      description: 'Path to promptfooconfig.yaml / .json / .json5',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description: 'Output path (default: EVAL.yaml beside the input config)',
    }),
    dryRun: flag({
      long: 'dry-run',
      description: 'Print the imported AgentV YAML instead of writing it',
    }),
  },
  handler: async ({ input, output, dryRun }) => {
    const absoluteInput = path.resolve(input);
    const yaml = await convertPromptfooToAgentvYaml(absoluteInput);

    if (dryRun) {
      process.stdout.write(yaml);
      return;
    }

    const outputPath = path.resolve(output ?? path.join(path.dirname(absoluteInput), 'EVAL.yaml'));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, yaml, 'utf8');
    console.log(`Imported promptfoo config → ${outputPath}`);
  },
});

async function loadPromptfooConfig(filePath: string): Promise<PromptfooConfig> {
  const content = await readFile(filePath, 'utf8');
  const parsed = parseStructuredText(content, filePath);
  if (!isJsonObject(parsed)) {
    throw new Error(`promptfoo config must be an object: ${filePath}`);
  }
  return parsed as PromptfooConfig;
}

function parseStructuredText(content: string, filePath: string): unknown {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' || ext === '.json5' || ext === '.jsonc') {
    return JSON5.parse(content);
  }
  try {
    return parseYaml(content);
  } catch (yamlError) {
    try {
      return JSON5.parse(content);
    } catch {
      throw yamlError;
    }
  }
}

async function loadPromptfooPrompts(rawPrompts: unknown, baseDir: string) {
  if (rawPrompts === undefined) {
    return [
      { key: 'prompt', label: 'prompt', source: 'implicit', content: '{{prompt}}' },
    ] satisfies readonly PromptfooPrompt[];
  }

  const entries = Array.isArray(rawPrompts) ? rawPrompts : [rawPrompts];
  const prompts: PromptfooPrompt[] = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const loaded = await expandPromptEntry(entry, baseDir, index);
    prompts.push(...loaded);
  }

  return prompts;
}

async function expandPromptEntry(rawPrompt: unknown, baseDir: string, index: number) {
  if (typeof rawPrompt === 'string') {
    if (rawPrompt.startsWith(FILE_PREFIX)) {
      return loadPromptFromReference(rawPrompt, baseDir, {
        key: `prompt-${index + 1}`,
        label: `prompt-${index + 1}`,
      });
    }
    return [
      {
        key: `prompt-${index + 1}`,
        label: `prompt-${index + 1}`,
        source: 'inline',
        content: rawPrompt,
      },
    ] satisfies readonly PromptfooPrompt[];
  }

  if (!isJsonObject(rawPrompt)) {
    throw new Error(`Unsupported prompt entry at index ${index + 1}: expected string or object`);
  }

  const raw = asString(rawPrompt.raw) ?? asString(rawPrompt.id);
  if (!raw) {
    throw new Error(
      `Unsupported prompt object at index ${index + 1}: expected 'raw' or file-backed 'id'`,
    );
  }

  const label = asString(rawPrompt.label) ?? asString(rawPrompt.id) ?? `prompt-${index + 1}`;
  const key = sanitizeName(asString(rawPrompt.id) ?? label);
  if (raw.startsWith(FILE_PREFIX)) {
    return loadPromptFromReference(raw, baseDir, { key, label });
  }
  if (raw.startsWith('exec:') || looksLikeExecutablePrompt(raw)) {
    throw new Error(
      `Unsupported prompt '${label}': executable and function-backed prompts need manual migration`,
    );
  }

  return [
    { key, label, source: 'inline-object', content: raw },
  ] satisfies readonly PromptfooPrompt[];
}

async function loadPromptFromReference(
  reference: string,
  baseDir: string,
  identity: { key: string; label: string },
) {
  const files = await resolvePromptfooFileReference(reference, baseDir);
  const prompts: PromptfooPrompt[] = [];

  for (let index = 0; index < files.length; index++) {
    const filePath = files[index];
    const ext = path.extname(filePath).toLowerCase();
    const raw = await readFile(filePath, 'utf8');

    if (ext === '.json' || ext === '.json5' || ext === '.jsonc') {
      const parsed = parseStructuredText(raw, filePath);
      if (!Array.isArray(parsed) || !parsed.every(isPromptMessage)) {
        throw new Error(
          `Unsupported prompt JSON file '${filePath}': expected a chat message array`,
        );
      }
      prompts.push({
        key: files.length === 1 ? identity.key : `${identity.key}-${index + 1}`,
        label: files.length === 1 ? identity.label : `${identity.label}-${index + 1}`,
        source: filePath,
        content: parsed.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      continue;
    }

    const segments = splitPromptText(raw);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const suffix =
        files.length === 1 && segments.length === 1 ? '' : `-${index + 1}-${segmentIndex + 1}`;
      prompts.push({
        key: `${identity.key}${suffix}`,
        label: `${identity.label}${suffix}`,
        source: filePath,
        content: segments[segmentIndex],
      });
    }
  }

  return prompts;
}

function splitPromptText(raw: string): readonly string[] {
  const segments = raw
    .split(/^\s*---\s*$/m)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments : [raw];
}

async function loadPromptfooProviders(rawProviders: unknown, baseDir: string) {
  if (rawProviders === undefined) {
    return [] as readonly PromptfooProvider[];
  }

  const entries = Array.isArray(rawProviders) ? rawProviders : [rawProviders];
  const providers: PromptfooProvider[] = [];
  for (const entry of entries) {
    const expanded = await expandProviderEntry(entry, baseDir);
    providers.push(...expanded);
  }
  return providers;
}

async function expandProviderEntry(rawProvider: unknown, baseDir: string) {
  if (typeof rawProvider === 'string') {
    if (rawProvider.startsWith(FILE_PREFIX)) {
      const files = await resolvePromptfooFileReference(rawProvider, baseDir);
      const providers: PromptfooProvider[] = [];
      for (const filePath of files) {
        const parsed = parseStructuredText(await readFile(filePath, 'utf8'), filePath);
        if (!isJsonObject(parsed)) {
          throw new Error(`Provider file must be an object: ${filePath}`);
        }
        providers.push(providerFromObject(parsed));
      }
      return providers;
    }
    return [providerFromString(rawProvider)] satisfies readonly PromptfooProvider[];
  }

  if (!isJsonObject(rawProvider)) {
    throw new Error('Unsupported provider entry: expected string or object');
  }

  return [providerFromObject(rawProvider)] satisfies readonly PromptfooProvider[];
}

function providerFromString(providerId: string): PromptfooProvider {
  const targetName = sanitizeName(providerId);
  return { id: providerId, targetName };
}

function providerFromObject(rawProvider: JsonObject): PromptfooProvider {
  const id = asString(rawProvider.id);
  if (!id) {
    throw new Error(`Unsupported provider object: missing 'id'`);
  }
  return {
    id,
    label: asString(rawProvider.label),
    targetName: sanitizeName(id),
  };
}

async function loadDefaultTest(rawDefaultTest: unknown, baseDir: string) {
  if (rawDefaultTest === undefined) {
    return {} as PromptfooTestCase;
  }
  if (typeof rawDefaultTest === 'string' && rawDefaultTest.startsWith(FILE_PREFIX)) {
    const files = await resolvePromptfooFileReference(rawDefaultTest, baseDir);
    if (files.length !== 1) {
      throw new Error(`defaultTest must resolve to exactly one file: ${rawDefaultTest}`);
    }
    const parsed = parseStructuredText(await readFile(files[0], 'utf8'), files[0]);
    if (!isJsonObject(parsed)) {
      throw new Error(`defaultTest file must contain an object: ${files[0]}`);
    }
    return parsed as PromptfooTestCase;
  }
  if (!isJsonObject(rawDefaultTest)) {
    throw new Error('Unsupported defaultTest: expected object or file:// reference');
  }
  return rawDefaultTest as PromptfooTestCase;
}

async function loadPromptfooTests(rawTests: unknown, baseDir: string) {
  if (rawTests === undefined) {
    throw new Error('promptfoo import requires a tests section in v1');
  }

  const entries = Array.isArray(rawTests) ? rawTests : [rawTests];
  const tests: PromptfooTestCase[] = [];

  for (const entry of entries) {
    const loaded = await expandTestEntry(entry, baseDir);
    tests.push(...loaded);
  }

  if (tests.length === 0) {
    throw new Error('promptfoo import found no test cases to convert');
  }

  return tests;
}

async function expandTestEntry(rawEntry: unknown, baseDir: string) {
  if (typeof rawEntry === 'string') {
    if (!rawEntry.startsWith(FILE_PREFIX)) {
      throw new Error(
        `Unsupported tests entry '${rawEntry}': expected file:// reference or object`,
      );
    }
    return loadPromptfooTestsFromReference(rawEntry, baseDir);
  }

  if (!isJsonObject(rawEntry)) {
    throw new Error('Unsupported tests entry: expected file:// reference or object');
  }

  if (typeof rawEntry.path === 'string') {
    throw new Error(
      `Unsupported promptfoo test generator '${rawEntry.path}': generators need manual migration`,
    );
  }

  return [rawEntry as PromptfooTestCase] satisfies readonly PromptfooTestCase[];
}

async function loadPromptfooTestsFromReference(reference: string, baseDir: string) {
  const files = await resolvePromptfooFileReference(reference, baseDir);
  const tests: PromptfooTestCase[] = [];

  for (const filePath of files) {
    const ext = path.extname(stripSheetSuffix(filePath)).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      throw new Error(
        `Unsupported test dataset '${path.basename(filePath)}': XLSX promptfoo datasets are not imported yet`,
      );
    }

    const content = await readFile(filePath, 'utf8');
    if (ext === '.csv') {
      tests.push(...parseCsvPromptfooTests(content, filePath));
      continue;
    }
    if (ext === '.jsonl') {
      for (const [index, line] of content.split('\n').entries()) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = JSON5.parse(trimmed);
        if (!isJsonObject(parsed)) {
          throw new Error(`Expected JSON object at ${filePath}:${index + 1}`);
        }
        tests.push(parsed as PromptfooTestCase);
      }
      continue;
    }

    const parsed = parseStructuredText(content, filePath);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!isJsonObject(entry)) {
          throw new Error(`Expected test objects in ${filePath}`);
        }
        tests.push(entry as PromptfooTestCase);
      }
      continue;
    }
    if (isJsonObject(parsed)) {
      tests.push(parsed as PromptfooTestCase);
      continue;
    }
    throw new Error(`Unsupported test file '${filePath}': expected object or array`);
  }

  return tests;
}

function parseCsvPromptfooTests(content: string, filePath: string): PromptfooTestCase[] {
  const rows = parseCsvRows(content, filePath);
  if (rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  if (!header || header.length === 0) {
    throw new Error(`CSV test file '${filePath}' is missing a header row`);
  }

  const tests: PromptfooTestCase[] = [];
  for (const [rowIndex, row] of dataRows.entries()) {
    if (row.every((value) => value.trim().length === 0)) {
      continue;
    }

    const record = Object.fromEntries(
      header.map((column, columnIndex) => [column, row[columnIndex] ?? '']),
    );
    tests.push(promptfooTestCaseFromCsvRow(record, filePath, rowIndex + 2));
  }

  return tests;
}

function parseCsvRows(content: string, filePath: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  if (inQuotes) {
    throw new Error(`Malformed CSV in '${filePath}': unterminated quoted field`);
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function promptfooTestCaseFromCsvRow(
  row: Record<string, string>,
  filePath: string,
  rowNumber: number,
): PromptfooTestCase {
  const vars: Record<string, JsonValue> = {};
  const metadata: Record<string, JsonValue> = {};
  const options: Record<string, JsonValue> = {};
  const assertions: JsonObject[] = [];
  const assertionConfigs = new Map<string, Record<string, JsonValue>>();
  let description: string | undefined;
  let threshold: number | undefined;

  for (const [column, rawValue] of Object.entries(row)) {
    const value = rawValue.trim();
    if (column.startsWith('__expected')) {
      if (!value) continue;
      const assertionKey = column;
      const assertion = parseCsvExpectedAssertion(value, filePath, rowNumber);
      const config = assertionConfigs.get(assertionKey);
      if (config) {
        Object.assign(assertion, config);
      }
      assertions.push(assertion);
      continue;
    }

    if (column === '__description') {
      description = value || undefined;
      continue;
    }

    if (column === '__prefix') {
      if (value) options.prefix = value;
      continue;
    }

    if (column === '__suffix') {
      if (value) options.suffix = value;
      continue;
    }

    if (column === '__threshold') {
      if (!value) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid __threshold value '${value}' in ${filePath}:${rowNumber}`);
      }
      threshold = parsed;
      continue;
    }

    if (column.startsWith('__metadata:')) {
      const key = column.slice('__metadata:'.length);
      if (!key) continue;
      metadata[key] = parseCsvScalarValue(value);
      continue;
    }

    if (column.startsWith('__config:')) {
      const remainder = column.slice('__config:'.length);
      const [target, ...configKeyParts] = remainder.split(':');
      const configKey = configKeyParts.join(':');
      if (!target || !configKey) {
        continue;
      }
      const config = assertionConfigs.get(target) ?? {};
      config[configKey] = parseCsvScalarValue(value);
      assertionConfigs.set(target, config);
      continue;
    }

    if (column === '__metric') {
      if (assertions.length === 0 || !value) continue;
      assertions[assertions.length - 1].metric = value;
      continue;
    }

    if (!column.startsWith('__')) {
      vars[column] = parseCsvScalarValue(rawValue);
    }
  }

  for (const [assertionKey, config] of assertionConfigs.entries()) {
    if (assertionKey === '__expected') {
      if (assertions[0]) Object.assign(assertions[0], config);
      continue;
    }
    const index = Number(assertionKey.replace('__expected', '')) - 1;
    if (Number.isInteger(index) && index >= 0 && assertions[index]) {
      Object.assign(assertions[index], config);
    }
  }

  return {
    ...(description ? { description } : {}),
    ...(Object.keys(vars).length > 0 ? { vars } : {}),
    ...(assertions.length > 0 ? { assert: assertions } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

function parseCsvExpectedAssertion(value: string, filePath: string, rowNumber: number): JsonObject {
  const thresholdMatch = value.match(/^([a-z0-9:-]+)\(([^)]+)\):(.*)$/i);
  if (thresholdMatch) {
    const [, type, thresholdText, remainder] = thresholdMatch;
    const threshold = Number(thresholdText.trim());
    if (!Number.isFinite(threshold)) {
      throw new Error(`Invalid assertion threshold '${thresholdText}' in ${filePath}:${rowNumber}`);
    }
    return {
      type,
      value: parseCsvAssertionValue(type, remainder.trim()),
      threshold,
    };
  }

  const separator = value.indexOf(':');
  if (separator === -1) {
    return { type: 'equals', value };
  }

  const type = value.slice(0, separator).trim();
  const remainder = value.slice(separator + 1).trim();
  if (!type) {
    throw new Error(`Invalid CSV assertion '${value}' in ${filePath}:${rowNumber}`);
  }

  return {
    type,
    ...(remainder ? { value: parseCsvAssertionValue(type, remainder) } : {}),
  };
}

function parseCsvAssertionValue(type: string, value: string): JsonValue {
  if (
    type === 'contains-any' ||
    type === 'contains-all' ||
    type === 'icontains-any' ||
    type === 'icontains-all'
  ) {
    return splitCsvAssertionList(value);
  }
  return parseCsvScalarValue(value);
}

function splitCsvAssertionList(value: string): JsonValue[] {
  const items: string[] = [];
  let current = '';
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (char === ',') {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  items.push(current.trim());
  return items.filter((item) => item.length > 0);
}

function parseCsvScalarValue(value: string): JsonValue {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed = JSON5.parse(trimmed);
      return isJsonValue(parsed) ? parsed : trimmed;
    } catch {
      return trimmed;
    }
  }
  return value;
}

async function buildAgentvTests(options: {
  readonly inputPath: string;
  readonly prompts: readonly PromptfooPrompt[];
  readonly defaultTest: PromptfooTestCase;
  readonly rawTests: readonly PromptfooTestCase[];
  readonly suiteTargetNames: readonly string[];
}) {
  const { inputPath, prompts, defaultTest, rawTests, suiteTargetNames } = options;
  const tests: AgentvTest[] = [];

  for (let index = 0; index < rawTests.length; index++) {
    const rawTest = rawTests[index];
    const explicitId = asString(rawTest.id);
    const descriptionId =
      typeof rawTest.description === 'string' ? sanitizeName(rawTest.description) : undefined;
    const baseId = explicitId ?? (descriptionId ? descriptionId : undefined) ?? `test-${index + 1}`;
    const testOptions = resolveTestOptions(defaultTest, rawTest);

    ensureSupportedTestOptions(testOptions, rawTest, inputPath);

    const effectiveVars = resolveMergedVars(defaultTest.vars, rawTest.vars, testOptions, inputPath);
    const promptSelection = filterPrompts(prompts, defaultTest.prompts, rawTest.prompts);
    if (promptSelection.length === 0) {
      throw new Error(`Test '${baseId}' matches no prompts after prompt filters`);
    }

    if (rawTest.providers !== undefined || rawTest.provider !== undefined) {
      throw new Error(
        `Promptfoo test '${baseId}' uses provider filters, which require unsupported per-case target selection. Split provider-specific cases before importing or use defaultTest provider filters for suite-level target selection.`,
      );
    }
    const convertedCaseAssertions = await convertPromptfooAssertions(
      readAssertionList(rawTest.assert),
      inputPath,
    );

    if (rawTest.providerOutput !== undefined) {
      throw new Error(`Test '${baseId}' uses providerOutput, which needs manual migration`);
    }

    if (
      convertedCaseAssertions.length === 0 &&
      readAssertionList(defaultTest.assert).length === 0
    ) {
      throw new Error(
        `Test '${baseId}' has no supported assertions after conversion; manual-review-only promptfoo tests are not imported in v1`,
      );
    }

    for (const prompt of promptSelection) {
      const importedVars = testOptions.disableVarExpansion ? undefined : effectiveVars;
      const templatedInput = buildPromptTemplate(prompt, testOptions);
      const promptSuffix =
        promptSelection.length > 1 ? `--${sanitizeName(prompt.key || prompt.label)}` : '';
      const metadata = buildPromptfooMetadata(rawTest, effectiveVars, prompt);
      const execution = buildCaseExecution({
        defaultAssertionsEnabled: !testOptions.disableDefaultAsserts,
        threshold: asNumber(rawTest.threshold),
      });

      const test: AgentvTest = {
        id: `${explicitId ?? baseId}${promptSuffix}`,
        ...(typeof rawTest.description === 'string' ? { criteria: rawTest.description } : {}),
        input: templatedInput,
        ...(importedVars && Object.keys(importedVars).length > 0 ? { vars: importedVars } : {}),
        ...(convertedCaseAssertions.length > 0 ? { assertions: convertedCaseAssertions } : {}),
        ...(metadata ? { metadata } : {}),
        ...(execution ? { execution } : {}),
      };
      tests.push(test);
    }
  }

  return tests;
}

function resolveTestOptions(
  defaultTest: PromptfooTestCase,
  rawTest: PromptfooTestCase,
): PromptfooTestOptions {
  const defaultOptions = isJsonObject(defaultTest.options) ? defaultTest.options : undefined;
  const rawOptions = isJsonObject(rawTest.options) ? rawTest.options : undefined;
  const options = {
    ...(defaultOptions ?? {}),
    ...(rawOptions ?? {}),
  };
  return {
    disableDefaultAsserts: asBoolean(options.disableDefaultAsserts),
    disableVarExpansion: asBoolean(options.disableVarExpansion),
    prefix: asString(options.prefix),
    suffix: asString(options.suffix),
    transform: asString(options.transform ?? options.postprocess),
    transformVars: asString(options.transformVars),
  };
}

function ensureSupportedTestOptions(
  testOptions: PromptfooTestOptions,
  rawTest: PromptfooTestCase,
  inputPath: string,
) {
  if (testOptions.transform) {
    throw new Error(
      `Test '${asString(rawTest.id) ?? asString(rawTest.description) ?? 'unknown'}' uses options.transform, which needs manual migration in ${inputPath}`,
    );
  }
  if (testOptions.transformVars) {
    throw new Error(
      `Test '${asString(rawTest.id) ?? asString(rawTest.description) ?? 'unknown'}' uses options.transformVars, which needs manual migration in ${inputPath}`,
    );
  }
}

function resolveMergedVars(
  defaultVars: unknown,
  testVars: unknown,
  testOptions: PromptfooTestOptions,
  inputPath: string,
) {
  const merged = {
    ...(normalizeVars(defaultVars, inputPath) ?? {}),
    ...(normalizeVars(testVars, inputPath) ?? {}),
  };

  if (!testOptions.disableVarExpansion) {
    const arrayKey = Object.entries(merged).find(([, value]) => Array.isArray(value))?.[0];
    if (arrayKey) {
      throw new Error(
        `Variable expansion is not imported yet. Pre-expand vars for key '${arrayKey}' before importing ${inputPath}`,
      );
    }
  }

  return merged;
}

function normalizeVars(rawVars: unknown, inputPath: string) {
  if (rawVars === undefined) return undefined;
  if (!isJsonObject(rawVars)) {
    throw new Error(`Unsupported vars shape in ${inputPath}: expected an object`);
  }
  const vars: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(rawVars)) {
    if (typeof value === 'string' && value.startsWith(FILE_PREFIX)) {
      throw new Error(
        `Variable '${key}' uses file:// loading, which needs manual migration in ${inputPath}`,
      );
    }
    if (!isJsonValue(value)) {
      throw new Error(`Variable '${key}' is not JSON-serializable in ${inputPath}`);
    }
    vars[key] = value;
  }
  return vars;
}

function filterPrompts(
  prompts: readonly PromptfooPrompt[],
  defaultFilters: unknown,
  testFilters: unknown,
) {
  const filters = parseStringList(testFilters) ?? parseStringList(defaultFilters);
  if (!filters || filters.length === 0) {
    return [...prompts];
  }
  return prompts.filter((prompt) =>
    filters.some((filter) => matchesFilter(filter, [prompt.label, prompt.key])),
  );
}

function filterProviders(
  providers: readonly PromptfooProvider[],
  rawFilter: unknown,
): readonly string[] | undefined {
  if (providers.length === 0) return undefined;

  const filters = parseStringList(rawFilter);
  if (!filters || filters.length === 0) {
    return undefined;
  }

  const matched = providers.filter((provider) =>
    filters.some((filter) =>
      matchesFilter(filter, [provider.id, provider.label, provider.targetName].filter(isPresent)),
    ),
  );

  if (matched.length === 0) {
    throw new Error(
      `Provider filter '${filters.join(', ')}' matches no configured promptfoo providers`,
    );
  }

  return matched.map((provider) => provider.targetName);
}

function buildPromptTemplate(
  prompt: PromptfooPrompt,
  testOptions: PromptfooTestOptions,
): AgentvInput {
  const prefix = testOptions.prefix ?? '';
  const suffix = testOptions.suffix ?? '';

  if (typeof prompt.content === 'string') {
    return `${prefix}${preserveTemplate(prompt.content)}${suffix}`;
  }

  return prompt.content.map((message, index, allMessages) => ({
    role: message.role,
    content: `${index === 0 ? prefix : ''}${preserveTemplate(message.content)}${index === allMessages.length - 1 ? suffix : ''}`,
  }));
}

function preserveTemplate(template: string) {
  if (template.includes('{%') || template.includes('{#') || /\{\{[^}]*\|/.test(template)) {
    throw new Error(
      `Unsupported Nunjucks syntax in prompt '${template.slice(0, 80)}'. Use simple {{var}} templates or migrate manually`,
    );
  }
  return template;
}

function buildPromptfooMetadata(
  rawTest: PromptfooTestCase,
  vars: Record<string, JsonValue>,
  prompt: PromptfooPrompt,
) {
  const rawMetadata = isJsonObject(rawTest.metadata) ? rawTest.metadata : undefined;
  const promptfooMetadata: Record<string, unknown> = {
    vars,
    prompt_label: prompt.label,
    prompt_source: prompt.source,
    ...(typeof rawTest.description === 'string' ? { description: rawTest.description } : {}),
  };

  return {
    ...(rawMetadata ?? {}),
    promptfoo: promptfooMetadata,
  } satisfies JsonObject;
}

function buildCaseExecution(options: {
  readonly defaultAssertionsEnabled: boolean;
  readonly threshold?: number;
}) {
  const execution: Record<string, unknown> = {};
  if (!options.defaultAssertionsEnabled) {
    execution.skip_defaults = true;
  }
  if (options.threshold !== undefined) {
    execution.threshold = options.threshold;
  }
  return Object.keys(execution).length > 0 ? execution : undefined;
}

async function convertPromptfooAssertions(
  rawAssertions: readonly unknown[],
  inputPath: string,
): Promise<AgentvAssertion[]> {
  const assertions: AgentvAssertion[] = [];
  for (const rawAssertion of rawAssertions) {
    const converted = await convertPromptfooAssertion(rawAssertion, inputPath);
    assertions.push(converted);
  }
  return assertions;
}

async function convertPromptfooAssertion(rawAssertion: unknown, inputPath: string) {
  if (!isJsonObject(rawAssertion)) {
    throw new Error(`Unsupported assertion in ${inputPath}: expected object entries`);
  }

  const rawType = asString(rawAssertion.type);
  if (!rawType) {
    throw new Error(`Unsupported assertion in ${inputPath}: missing type`);
  }

  const { negate, type } = normalizeAssertionType(rawType);
  const common = {
    ...(typeof rawAssertion.metric === 'string' ? { name: rawAssertion.metric } : {}),
    ...(typeof rawAssertion.weight === 'number' ? { weight: rawAssertion.weight } : {}),
    ...(negate ? { negate: true } : {}),
  };

  switch (type) {
    case 'contains':
    case 'icontains':
    case 'regex':
    case 'equals':
    case 'starts-with':
    case 'ends-with': {
      const value = asString(rawAssertion.value);
      if (!value) {
        throw new Error(`Assertion '${rawType}' is missing a string value in ${inputPath}`);
      }
      return { type, value, ...common } satisfies AgentvAssertion;
    }

    case 'contains-any':
    case 'contains-all':
    case 'icontains-any':
    case 'icontains-all': {
      const value = parseStringList(rawAssertion.value);
      if (!value || value.length === 0) {
        throw new Error(`Assertion '${rawType}' needs a string array value in ${inputPath}`);
      }
      return { type, value, ...common } satisfies AgentvAssertion;
    }

    case 'is-json': {
      if (rawAssertion.value !== undefined || rawAssertion.schema !== undefined) {
        throw new Error(
          `Assertion '${rawType}' uses JSON schema validation, which needs manual migration`,
        );
      }
      return { type: 'is-json', ...common } satisfies AgentvAssertion;
    }

    case 'llm-rubric': {
      const value = asString(rawAssertion.value);
      if (!value) {
        throw new Error(`Assertion '${rawType}' needs a rubric string in ${inputPath}`);
      }
      return { type: 'llm-grader', prompt: value, ...common } satisfies AgentvAssertion;
    }

    case 'g-eval':
    case 'factuality':
    case 'context-faithfulness':
    case 'context-recall': {
      const value = asString(rawAssertion.value);
      const prompt = buildModelGraderPrompt(type, value);
      return { type: 'llm-grader', prompt, ...common } satisfies AgentvAssertion;
    }

    case 'latency': {
      const threshold = asNumber(rawAssertion.threshold);
      if (threshold === undefined) {
        throw new Error(`Assertion '${rawType}' needs a numeric threshold in ${inputPath}`);
      }
      return { type: 'latency', threshold, ...common } satisfies AgentvAssertion;
    }

    case 'cost': {
      const threshold = asNumber(rawAssertion.threshold);
      if (threshold === undefined) {
        throw new Error(`Assertion '${rawType}' needs a numeric threshold in ${inputPath}`);
      }
      return { type: 'cost', budget: threshold, ...common } satisfies AgentvAssertion;
    }

    case 'assert-set':
    case 'javascript':
    case 'python':
    case 'similar':
    case 'contains-json':
    case 'is-html':
    case 'contains-html':
    case 'is-sql':
    case 'contains-sql':
    case 'is-xml':
    case 'contains-xml':
    case 'webhook':
    case 'trajectory:tool-used':
    case 'trajectory:tool-sequence':
    case 'trajectory:tool-args-match':
    case 'tool-call-f1':
      throw new Error(
        `Unsupported promptfoo assertion '${rawType}' in ${inputPath}. This v1 importer only converts deterministic and rubric-based assertions that map cleanly to AgentV`,
      );

    default:
      throw new Error(`Unsupported promptfoo assertion '${rawType}' in ${inputPath}`);
  }
}

function buildModelGraderPrompt(type: string, value?: string) {
  switch (type) {
    case 'g-eval':
      return value
        ? `Grade the assistant response using step-by-step reasoning against this rubric:\n${value}`
        : 'Grade the assistant response using step-by-step reasoning.';
    case 'factuality':
      return value
        ? `Determine whether the assistant response is factually consistent with these reference facts:\n${value}`
        : 'Determine whether the assistant response is factually correct.';
    case 'context-faithfulness':
      return value
        ? `Determine whether the assistant response is faithful to the provided context. Use this rubric:\n${value}`
        : 'Determine whether the assistant response is faithful to the provided context.';
    case 'context-recall':
      return value
        ? `Determine whether the required reference facts are recoverable from the provided context. Use this rubric:\n${value}`
        : 'Determine whether the required reference facts are recoverable from the provided context.';
    default:
      return value ?? `Grade the response for ${type}.`;
  }
}

function readAssertionList(rawAssertions: unknown) {
  if (rawAssertions === undefined) return [] as readonly JsonValue[];
  if (!Array.isArray(rawAssertions)) {
    throw new Error('promptfoo assert must be an array');
  }
  return rawAssertions;
}

function normalizeAssertionType(rawType: string) {
  if (rawType.startsWith('not-')) {
    return { negate: true, type: rawType.slice(4) };
  }
  return { negate: false, type: rawType };
}

async function resolvePromptfooFileReference(reference: string, baseDir: string) {
  const rawPath = reference.slice(FILE_PREFIX.length);
  const [pathWithoutSheet] = rawPath.split('#');
  const absolutePath = path.resolve(baseDir, pathWithoutSheet);
  const normalizedPattern = absolutePath.replaceAll('\\', '/');
  const matches = await fg(normalizedPattern, {
    onlyFiles: true,
    absolute: true,
  });
  if (matches.length === 0) {
    throw new Error(`promptfoo file reference matched no files: ${reference}`);
  }
  matches.sort();
  return matches;
}

function stripSheetSuffix(filePath: string) {
  const hashIndex = filePath.indexOf('#');
  return hashIndex === -1 ? filePath : filePath.slice(0, hashIndex);
}

function matchesFilter(filter: string, values: readonly string[]) {
  return values.some((value) => {
    if (filter === value) return true;
    if (filter.endsWith(':*')) {
      return value.startsWith(filter.slice(0, -1));
    }
    if (!filter.includes('*') && filter.endsWith(':')) {
      return value.startsWith(filter);
    }
    if (!filter.includes(':') && value.startsWith(`${filter}:`)) {
      return true;
    }
    const regex = new RegExp(
      `^${filter.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`,
    );
    return regex.test(value);
  });
}

function parseStringList(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === 'string');
  return values.length > 0 ? values : undefined;
}

function sanitizeName(input: string) {
  return input
    .trim()
    .replace(/[\/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function looksLikeExecutablePrompt(raw: string) {
  return raw.startsWith('./') || raw.endsWith('.sh') || raw.endsWith('.py') || raw.endsWith('.js');
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  if (isJsonObject(value)) {
    return Object.values(value).every((entry) => isJsonValue(entry));
  }
  return false;
}

function isPromptMessage(
  value: unknown,
): value is { role: 'system' | 'user' | 'assistant' | 'tool'; content: string } {
  return (
    isJsonObject(value) &&
    (value.role === 'system' ||
      value.role === 'user' ||
      value.role === 'assistant' ||
      value.role === 'tool') &&
    typeof value.content === 'string'
  );
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
