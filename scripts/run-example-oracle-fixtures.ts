#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { readTargetDefinitions } from '../packages/core/src/evaluation/providers/targets-file.ts';
import type { TargetDefinition } from '../packages/core/src/evaluation/providers/types.ts';
import type {
  EvalTargetRef,
  GraderConfig,
  JsonObject,
} from '../packages/core/src/evaluation/types.ts';
import {
  extractTargetFromSuite,
  extractTargetRefsFromSuite,
  extractTargetsFromSuite,
  loadTestSuite,
} from '../packages/core/src/evaluation/yaml-parser.ts';

const ROOT = path.resolve(import.meta.dir, '..');
const MANIFEST_PATH = path.join(ROOT, 'examples/oracle-fixtures.yaml');
const SOURCE_TARGET_FALLBACK = 'example_oracle_source';
const TARGET_NAME_FALLBACK = 'example_oracle';
const GRADER_TARGET_FALLBACK = 'example_oracle_grader';
const REPLAY_SCHEMA_VERSION = 'agentv.replay_fixture.v1';
const TARGET_FILE_CANDIDATES = [
  'targets.yaml',
  'targets.yml',
  '.agentv/targets.yaml',
  '.agentv/targets.yml',
] as const;
const ORACLE_PROVIDER_KINDS = new Set(['cli', 'copilot-log', 'mock', 'replay', 'transcript']);
const PROVIDER_ALIASES = new Map([
  ['azure-openai', 'azure'],
  ['google', 'gemini'],
  ['google-gemini', 'gemini'],
  ['codex-cli', 'codex'],
  ['copilot', 'copilot-cli'],
  ['copilot_sdk', 'copilot-sdk'],
  ['pi', 'pi-coding-agent'],
  ['claude-code', 'claude'],
  ['cc-mirror', 'claude-cli'],
]);

interface Manifest {
  readonly schema_version: string;
  readonly target_name?: string;
  readonly source_target?: string;
  readonly grader_target?: string;
  readonly exclusions?: readonly { readonly path: string; readonly reason: string }[];
}

interface InventoryEntry {
  readonly path: string;
  readonly classification:
    | 'requires_oracle_fixture'
    | 'oracle_target'
    | 'needs_fixture_added'
    | 'excluded';
  readonly tests: number;
  readonly fixture_source?: 'expected_output' | 'assertion_synthesis' | 'mixed';
  readonly targets?: readonly string[];
  readonly reason?: string;
}

interface ReplayMessage {
  readonly role: 'assistant';
  readonly content: string;
  readonly tool_calls?: readonly {
    readonly tool: string;
    readonly input?: unknown;
    readonly output?: unknown;
    readonly status: 'ok';
    readonly duration_ms: number;
  }[];
}

interface GeneratedCase {
  readonly content: string;
  readonly source: 'expected_output' | 'assertion_synthesis';
  readonly toolCalls: NonNullable<ReplayMessage['tool_calls']>;
}

interface CliOptions {
  readonly inventoryOnly: boolean;
  readonly json: boolean;
  readonly evalFilters: readonly string[];
  readonly outputDir?: string;
}

interface RawTargetMetadata {
  readonly target?: string;
  readonly targets?: readonly string[];
  readonly targetRefs?: readonly EvalTargetRef[];
}

interface TargetRequirement {
  readonly requiresOracle: boolean;
  readonly targets: readonly string[];
  readonly reason: string;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const evalFilters: string[] = [];
  let inventoryOnly = false;
  let json = false;
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--inventory') {
      inventoryOnly = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--eval') {
      const value = argv[++index];
      if (!value) throw new Error('--eval requires a path');
      evalFilters.push(normalizePath(value));
    } else if (arg === '--output-dir') {
      const value = argv[++index];
      if (!value) throw new Error('--output-dir requires a path');
      outputDir = value;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { inventoryOnly, json, evalFilters, outputDir };
}

function printHelp() {
  console.log(`Usage: bun scripts/run-example-oracle-fixtures.ts [options]

Options:
  --inventory           Print inventory only; do not run evals.
  --json                Emit JSON summary.
  --eval <path>         Limit to one eval path. Repeatable.
  --output-dir <path>   Directory for generated fixtures and run outputs.
`);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function relativePath(filePath: string): string {
  return normalizePath(path.relative(ROOT, filePath));
}

function loadManifest(): Manifest {
  return parseYaml(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

function readRawTargetMetadata(filePath: string): RawTargetMetadata {
  if (/\.tsx?$/i.test(filePath)) {
    return {};
  }

  try {
    const parsed = parseYaml(readFileSync(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const suite = parsed as JsonObject;
    return {
      target: extractTargetFromSuite(suite),
      targets: extractTargetsFromSuite(suite),
      targetRefs: extractTargetRefsFromSuite(suite),
    };
  } catch {
    return {};
  }
}

function targetFileChain(evalFilePath: string): string[] {
  const directories: string[] = [];
  let current = path.dirname(evalFilePath);
  while (true) {
    directories.push(current);
    if (current === ROOT) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const files: string[] = [];
  for (const directory of directories) {
    for (const candidate of TARGET_FILE_CANDIDATES) {
      const filePath = path.join(directory, candidate);
      if (existsSync(filePath)) files.push(filePath);
    }
  }
  return files;
}

async function loadNearestTargetDefinitions(
  evalFilePath: string,
): Promise<readonly TargetDefinition[]> {
  const [targetsFile] = targetFileChain(evalFilePath);
  if (!targetsFile) {
    return [];
  }
  return readTargetDefinitions(targetsFile);
}

function canonicalProvider(provider: unknown): string | undefined {
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    return undefined;
  }
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_ALIASES.get(normalized) ?? normalized;
}

function resolveUseTargetName(value: unknown): { name?: string; env?: string } {
  if (typeof value !== 'string') {
    return {};
  }
  const raw = value.trim();
  if (raw.length === 0) {
    return {};
  }
  const envMatch = raw.match(/^\$\{\{\s*([A-Z0-9_]+)\s*\}\}$/i);
  if (!envMatch) {
    return { name: raw };
  }
  const env = envMatch[1];
  const resolved = process.env[env]?.trim();
  return resolved ? { name: resolved, env } : { env };
}

function resolveTargetRequirementFromDefinition(
  name: string,
  definitions: readonly TargetDefinition[],
  visited: readonly string[] = [],
): TargetRequirement {
  const definition = definitions.find((item) => item.name === name);
  if (!definition) {
    return {
      requiresOracle: true,
      targets: [name],
      reason: `target '${name}' could not be resolved to an oracle provider`,
    };
  }

  const provider = canonicalProvider(definition.provider);
  if (provider) {
    const oracleProvider = ORACLE_PROVIDER_KINDS.has(provider);
    return {
      requiresOracle: !oracleProvider,
      targets: [name],
      reason: oracleProvider
        ? `target '${name}' uses oracle provider '${provider}'`
        : `target '${name}' uses non-oracle provider '${provider}'`,
    };
  }

  const useTarget = resolveUseTargetName(definition.use_target);
  if (!useTarget.name) {
    return {
      requiresOracle: true,
      targets: [name],
      reason: useTarget.env
        ? `target '${name}' delegates through unset ${useTarget.env}`
        : `target '${name}' does not declare a concrete oracle provider`,
    };
  }

  if (visited.includes(useTarget.name)) {
    return {
      requiresOracle: true,
      targets: [name],
      reason: `target '${name}' has a cyclic use_target chain`,
    };
  }

  const resolved = resolveTargetRequirementFromDefinition(useTarget.name, definitions, [
    ...visited,
    name,
  ]);
  return {
    requiresOracle: resolved.requiresOracle,
    targets: [name, ...resolved.targets],
    reason: `target '${name}' delegates to ${resolved.reason}`,
  };
}

function targetNamesFromMetadata(options: {
  readonly suiteTargets?: readonly string[];
  readonly suiteTargetRefs?: readonly EvalTargetRef[];
  readonly raw: RawTargetMetadata;
}): readonly string[] {
  const refs = options.suiteTargetRefs ?? options.raw.targetRefs;
  if (refs && refs.length > 0) {
    return refs.map((ref) => ref.name);
  }
  if (options.suiteTargets && options.suiteTargets.length > 0) {
    return options.suiteTargets;
  }
  if (options.raw.targets && options.raw.targets.length > 0) {
    return options.raw.targets;
  }
  return [options.raw.target ?? 'default'];
}

async function classifyTargetRequirement(options: {
  readonly file: string;
  readonly suite: Awaited<ReturnType<typeof loadTestSuite>>;
}): Promise<TargetRequirement> {
  const raw = readRawTargetMetadata(options.file);

  if (options.suite.providerFactory) {
    return {
      requiresOracle: false,
      targets: ['providerFactory'],
      reason: 'eval uses a local provider factory',
    };
  }

  if (options.suite.inlineTarget) {
    const provider = canonicalProvider(options.suite.inlineTarget.provider);
    const oracleProvider = provider ? ORACLE_PROVIDER_KINDS.has(provider) : false;
    return {
      requiresOracle: !oracleProvider,
      targets: [options.suite.inlineTarget.name],
      reason: oracleProvider
        ? `inline target uses oracle provider '${provider}'`
        : `inline target uses non-oracle provider '${provider ?? 'unknown'}'`,
    };
  }

  let definitions = await loadNearestTargetDefinitions(options.file);
  const refs = options.suite.targetRefs ?? raw.targetRefs;
  if (refs) {
    const synthetic = refs
      .filter(
        (ref) => ref.use_target && !definitions.some((definition) => definition.name === ref.name),
      )
      .map((ref) => ({ name: ref.name, use_target: ref.use_target }) as TargetDefinition);
    definitions = [...definitions, ...synthetic];
  }

  const targetNames = targetNamesFromMetadata({
    suiteTargets: options.suite.targets,
    suiteTargetRefs: options.suite.targetRefs,
    raw,
  });
  const requirements = targetNames.map((name) =>
    resolveTargetRequirementFromDefinition(name, definitions),
  );
  const requiresOracle = requirements.some((requirement) => requirement.requiresOracle);
  return {
    requiresOracle,
    targets: [...new Set(requirements.flatMap((requirement) => requirement.targets))],
    reason: requirements.map((requirement) => requirement.reason).join('; '),
  };
}

function discoverEvalFiles(filters: readonly string[]): string[] {
  const patterns = [
    'examples/**/*.eval.yaml',
    'examples/**/*.EVAL.yaml',
    'examples/**/EVAL.yaml',
    'examples/**/evals/eval.yaml',
    'examples/**/evals.json',
    'examples/**/*.evals.json',
    'examples/**/*.eval.json',
    'examples/**/*.eval.ts',
    'examples/**/*.EVAL.ts',
  ];
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const match of globSync(pattern, { cwd: ROOT })) {
      const normalized = normalizePath(match);
      if (filters.length === 0 || filters.includes(normalized)) {
        files.add(path.join(ROOT, normalized));
      }
    }
  }
  return [...files].sort((a, b) => relativePath(a).localeCompare(relativePath(b)));
}

function lastAssistantContent(messages: readonly JsonObject[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (content !== undefined) return JSON.stringify(content, null, 2);
  }
  return undefined;
}

function collectAssertions(assertions: readonly GraderConfig[] | undefined): GraderConfig[] {
  const collected: GraderConfig[] = [];
  for (const assertion of assertions ?? []) {
    collected.push(assertion);
    if (assertion.type === 'composite') {
      collected.push(...collectAssertions(assertion.assertions as readonly GraderConfig[]));
    }
  }
  return collected;
}

function valuesForAssertion(assertion: GraderConfig): readonly string[] {
  const value = (assertion as { readonly value?: unknown }).value;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

function simpleRegexExample(pattern: string): string {
  return pattern
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\d\{4\}-\\d\{2\}-\\d\{2\}/g, '2026-01-01')
    .replace(/\\d\{3\}-\\d\{2\}-\\d\{4\}/g, '123-45-6789')
    .replace(/\\d\+/g, '123')
    .replace(/\(([^|)]+)(?:\|[^)]*)+\)/g, '$1')
    .replace(/\.\*/g, ' ')
    .replace(/\\s\+/g, ' ')
    .replace(/\\b/g, '')
    .replace(/\\/g, '');
}

function buildToolCalls(assertions: readonly GraderConfig[]): ReplayMessage['tool_calls'] {
  const toolCalls: NonNullable<ReplayMessage['tool_calls']> = [];

  for (const assertion of assertions) {
    if (assertion.type === 'tool-trajectory') {
      const expected = (assertion as { readonly expected?: readonly Record<string, unknown>[] })
        .expected;
      const minimums = (assertion as { readonly minimums?: Record<string, number> }).minimums;

      if (expected) {
        for (const item of expected) {
          if (typeof item.tool !== 'string') continue;
          toolCalls.push({
            tool: item.tool,
            input: item.args === 'any' ? {} : item.args,
            output: item.output,
            status: 'ok',
            duration_ms: Math.min(
              typeof item.max_duration_ms === 'number' ? item.max_duration_ms : 1,
              1,
            ),
          });
        }
      }

      if (minimums) {
        for (const [tool, count] of Object.entries(minimums)) {
          for (let index = 0; index < count; index++) {
            toolCalls.push({ tool, input: {}, output: {}, status: 'ok', duration_ms: 1 });
          }
        }
      }
    }

    if (
      assertion.type === 'execution-metrics' &&
      typeof (assertion as { readonly target_exploration_ratio?: unknown })
        .target_exploration_ratio === 'number' &&
      toolCalls.length === 0
    ) {
      toolCalls.push(
        { tool: 'search', input: {}, output: {}, status: 'ok', duration_ms: 1 },
        { tool: 'search', input: {}, output: {}, status: 'ok', duration_ms: 1 },
        { tool: 'search', input: {}, output: {}, status: 'ok', duration_ms: 1 },
        { tool: 'edit', input: {}, output: {}, status: 'ok', duration_ms: 1 },
        { tool: 'edit', input: {}, output: {}, status: 'ok', duration_ms: 1 },
      );
    }
  }

  return toolCalls;
}

function synthesizedContent(testId: string, assertions: readonly GraderConfig[]): string {
  const exact = assertions.find((assertion) => assertion.type === 'equals');
  if (exact) {
    const [value] = valuesForAssertion(exact);
    if (value) return value;
  }

  const requiresJson = assertions.some(
    (assertion) => assertion.type === 'is-json' || assertion.type === 'field-accuracy',
  );
  const startsWith = assertions.find((assertion) => assertion.type === 'starts-with');
  const endsWith = assertions.find((assertion) => assertion.type === 'ends-with');
  const parts: string[] = [];

  if (startsWith) {
    const [value] = valuesForAssertion(startsWith);
    if (value) parts.push(value);
  }

  for (const assertion of assertions) {
    if ((assertion as { readonly negate?: boolean }).negate) continue;
    if (
      [
        'contains',
        'contains-any',
        'contains-all',
        'icontains',
        'icontains-any',
        'icontains-all',
      ].includes(assertion.type)
    ) {
      const values = valuesForAssertion(assertion);
      parts.push(...(assertion.type.endsWith('-any') ? values.slice(0, 1) : values));
    } else if (assertion.type === 'regex') {
      const [pattern] = valuesForAssertion(assertion);
      if (pattern) parts.push(simpleRegexExample(pattern));
    }
  }

  if (endsWith) {
    const [value] = valuesForAssertion(endsWith);
    if (value) parts.push(value);
  }

  const text =
    [...new Set(parts.filter(Boolean))].join(' ') || `Oracle fixture output for ${testId}.`;
  return requiresJson ? JSON.stringify({ status: 'ok', message: text }) : text;
}

function generatedCase(test: {
  readonly id: string;
  readonly reference_answer?: string;
  readonly expected_output: readonly JsonObject[];
  readonly assertions?: readonly GraderConfig[];
}): GeneratedCase {
  const reference = test.reference_answer?.trim() || lastAssistantContent(test.expected_output);
  if (reference?.trim()) {
    return {
      content: reference,
      source: 'expected_output',
      toolCalls: buildToolCalls(collectAssertions(test.assertions)),
    };
  }

  const assertions = collectAssertions(test.assertions);
  return {
    content: synthesizedContent(test.id, assertions),
    source: 'assertion_synthesis',
    toolCalls: buildToolCalls(assertions),
  };
}

async function buildInventory(
  files: readonly string[],
  manifest: Manifest,
): Promise<{
  entries: InventoryEntry[];
  records: string[];
  oracleFiles: string[];
}> {
  const exclusions = new Map(
    (manifest.exclusions ?? []).map((item) => [normalizePath(item.path), item.reason]),
  );
  const records: string[] = [];
  const entries: InventoryEntry[] = [];
  const oracleFiles: string[] = [];
  const sourceTarget = manifest.source_target ?? SOURCE_TARGET_FALLBACK;

  for (const file of files) {
    const rel = relativePath(file);
    const excludedReason = exclusions.get(rel);
    if (excludedReason) {
      entries.push({ path: rel, classification: 'excluded', tests: 0, reason: excludedReason });
      continue;
    }

    try {
      const suite = await loadTestSuite(file, ROOT);
      const targetRequirement = await classifyTargetRequirement({ file, suite });
      if (suite.tests.length === 0) {
        entries.push({
          path: rel,
          classification: 'excluded',
          tests: 0,
          reason: 'AgentV loader returned zero runnable tests.',
        });
        continue;
      }

      if (!targetRequirement.requiresOracle) {
        entries.push({
          path: rel,
          classification: 'oracle_target',
          tests: suite.tests.length,
          targets: targetRequirement.targets,
          reason: targetRequirement.reason,
        });
        continue;
      }

      let expected = 0;
      let synthesized = 0;
      for (const test of suite.tests) {
        const generated = generatedCase(test);
        if (generated.source === 'expected_output') expected++;
        else synthesized++;

        const message: ReplayMessage = {
          role: 'assistant',
          content: generated.content,
          ...(generated.toolCalls.length > 0 ? { tool_calls: generated.toolCalls } : {}),
        };
        records.push(
          JSON.stringify({
            schema_version: REPLAY_SCHEMA_VERSION,
            suite: test.suite ?? suite.metadata?.name ?? path.basename(file),
            eval_path: rel,
            test_id: test.id,
            source_target: sourceTarget,
            attempt: 0,
            variant: null,
            recorded_at: '2026-01-01T00:00:00.000Z',
            source: { kind: 'example_oracle_fixture' },
            output: [message],
            token_usage: { input: 0, output: 0 },
            cost_usd: 0,
            duration_ms: 1,
          }),
        );
      }

      oracleFiles.push(file);
      entries.push({
        path: rel,
        classification: 'requires_oracle_fixture',
        tests: suite.tests.length,
        targets: targetRequirement.targets,
        fixture_source:
          expected > 0 && synthesized > 0
            ? 'mixed'
            : expected > 0
              ? 'expected_output'
              : 'assertion_synthesis',
      });
    } catch (error) {
      entries.push({
        path: rel,
        classification: 'excluded',
        tests: 0,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { entries, records, oracleFiles };
}

function writeGeneratedFiles(options: {
  readonly outputDir: string;
  readonly records: readonly string[];
  readonly manifest: Manifest;
}): { readonly targetsPath: string; readonly fixturePath: string } {
  mkdirSync(options.outputDir, { recursive: true });
  const fixturePath = path.join(options.outputDir, 'target-output.jsonl');
  const targetsPath = path.join(options.outputDir, 'targets.yaml');
  writeFileSync(fixturePath, `${options.records.join('\n')}\n`, 'utf8');

  const targetName = options.manifest.target_name ?? TARGET_NAME_FALLBACK;
  const sourceTarget = options.manifest.source_target ?? SOURCE_TARGET_FALLBACK;
  const graderTarget = options.manifest.grader_target ?? GRADER_TARGET_FALLBACK;
  writeFileSync(
    targetsPath,
    stringifyYaml({
      targets: [
        {
          name: targetName,
          provider: 'replay',
          fixtures: fixturePath,
          source_target: sourceTarget,
        },
        {
          name: graderTarget,
          provider: 'cli',
          command: `bun ${path.join(ROOT, 'scripts/example-oracle-grader.ts')} --prompt-file {PROMPT_FILE} --output {OUTPUT_FILE}`,
          timeout_seconds: 30,
        },
      ],
    }),
    'utf8',
  );
  return { targetsPath, fixturePath };
}

function printInventory(entries: readonly InventoryEntry[]) {
  const counts = countBy(entries, (entry) => entry.classification);
  console.log(
    `Example oracle inventory: ${entries.length} eval files | ${counts.requires_oracle_fixture ?? 0} require oracle | ${counts.oracle_target ?? 0} oracle target | ${counts.needs_fixture_added ?? 0} need fixture | ${counts.excluded ?? 0} excluded`,
  );
  for (const entry of entries) {
    const detail = entry.reason ?? entry.fixture_source ?? '';
    const targets = entry.targets?.length ? entry.targets.join(',') : '';
    console.log(`${entry.classification}\t${entry.tests}\t${entry.path}\t${targets}\t${detail}`);
  }
}

function countBy<TValue, TKey extends string>(
  values: readonly TValue[],
  keyFn: (value: TValue) => TKey,
): Record<TKey, number> {
  const counts = {} as Record<TKey, number>;
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function runEval(options: {
  readonly file: string;
  readonly outputRoot: string;
  readonly targetsPath: string;
  readonly manifest: Manifest;
}): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  const rel = relativePath(options.file);
  const safeName = rel.replace(/[^a-zA-Z0-9._-]+/g, '__');
  const outputDir = path.join(options.outputRoot, 'runs', `${safeName}.run`);
  mkdirSync(path.dirname(outputDir), { recursive: true });

  const result = spawnSync(
    'bun',
    [
      'apps/cli/src/cli.ts',
      'eval',
      rel,
      '--targets',
      options.targetsPath,
      '--target',
      options.manifest.target_name ?? TARGET_NAME_FALLBACK,
      '--grader-target',
      options.manifest.grader_target ?? GRADER_TARGET_FALLBACK,
      '--output',
      outputDir,
      '--workers',
      '1',
      '--threshold',
      '0',
      '--no-cache',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVAL_CRITERIA: process.env.EVAL_CRITERIA ?? 'oracle fixture criteria',
        CUSTOM_SYSTEM_PROMPT: process.env.CUSTOM_SYSTEM_PROMPT ?? 'oracle fixture system prompt',
        OFFLINE: process.env.OFFLINE ?? '1',
      },
    },
  );

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const manifest = loadManifest();
  const files = discoverEvalFiles(options.evalFilters);
  if (files.length === 0) {
    throw new Error('No example eval files matched.');
  }

  const inventory = await buildInventory(files, manifest);
  const outputRoot = path.resolve(
    ROOT,
    options.outputDir ??
      `.agentv/tmp/example-oracle-fixtures/${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );

  if (options.inventoryOnly) {
    if (options.json) console.log(JSON.stringify({ entries: inventory.entries }, null, 2));
    else printInventory(inventory.entries);
    return;
  }

  const generated = writeGeneratedFiles({
    outputDir: outputRoot,
    records: inventory.records,
    manifest,
  });

  const failures: { path: string; status: number; stderr: string }[] = [];
  for (const file of inventory.oracleFiles) {
    const rel = relativePath(file);
    console.log(`Running oracle example eval: ${rel}`);
    const result = runEval({
      file,
      outputRoot,
      targetsPath: generated.targetsPath,
      manifest,
    });
    if (result.status !== 0) {
      failures.push({ path: rel, status: result.status, stderr: result.stderr || result.stdout });
      console.error(`Oracle run failed for ${rel} (exit ${result.status})`);
    }
  }

  const summary = {
    inventory: inventory.entries,
    output_dir: outputRoot,
    targets_path: generated.targetsPath,
    fixtures_path: generated.fixturePath,
    oracle_required_count: inventory.oracleFiles.length,
    failure_count: failures.length,
    failures,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printInventory(inventory.entries);
    console.log(`Generated replay fixtures: ${generated.fixturePath}`);
    console.log(`Generated targets: ${generated.targetsPath}`);
    console.log(`Oracle run output: ${outputRoot}`);
    console.log(
      `Oracle-required evals: ${inventory.oracleFiles.length} | Failures: ${failures.length}`,
    );
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
