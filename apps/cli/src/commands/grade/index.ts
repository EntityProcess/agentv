/**
 * `agentv grade` evaluates a workspace that was previously materialized by
 * `agentv prepare` and then edited by a human or external agent. This command
 * deliberately stops short of provider execution: the prepared manifest is the
 * source of workspace, prompt, target, setup, and baseline provenance, while
 * core grader/result primitives produce the normal run artifacts.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  EXECUTION_TRACE_SCHEMA_VERSION,
  type PreparedAttemptMetadata,
  type ResolvedTarget,
  type Trace,
  type TranscriptJsonLine,
  buildTraceFromMessages,
  deriveCategory,
  gradePreparedEvalCase,
  loadTestSuite,
  readTraceEnvelopeReplayRecords,
  readTranscriptJsonl,
  traceEnvelopeToTraceSummary,
  traceEnvelopeToTranscriptMessages,
  traceFromTranscriptJsonLines,
  writeArtifactsFromResults,
} from '@agentv/core';
import { command, number, oneOf, option, optional, positional, string } from 'cmd-ts';

import { loadEnvFromHierarchy } from '../eval/env.js';
import { buildDefaultRunDir } from '../eval/result-layout.js';
import { findRepoRoot } from '../eval/shared.js';
import { selectMultipleTargets } from '../eval/targets.js';

interface PreparedBaseline {
  readonly status: 'initialized' | 'unavailable';
  readonly commit?: string;
}

interface PreparedManifest {
  readonly schemaVersion: 1;
  readonly evalPath: string;
  readonly testId: string;
  readonly target: string;
  readonly workspacePath: string;
  readonly promptPath: string;
  readonly setupStatus: 'ok';
  readonly baseline: PreparedBaseline;
  readonly createdAt: string;
  readonly manifestPath: string;
  readonly preparedDir: string;
}

interface GradePreparedResult {
  readonly testId: string;
  readonly target: string;
  readonly score: number;
  readonly executionStatus: string;
  readonly workspacePath: string;
  readonly manifestPath: string;
  readonly tracePath?: string;
  readonly outputDir: string;
  readonly indexPath: string;
}

interface GradePreparedResultWire {
  readonly test_id: string;
  readonly target: string;
  readonly score: number;
  readonly execution_status: string;
  readonly workspace_path: string;
  readonly manifest_path: string;
  readonly trace_path?: string;
  readonly output_dir: string;
  readonly index_path: string;
}

interface PreparedTraceInput {
  readonly trace: Trace;
  readonly sourcePath: string;
}

interface TranscriptLineGroup {
  readonly testId: string;
  readonly target: string;
  readonly lines: readonly TranscriptJsonLine[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidManifest(manifestPath: string, message: string): Error {
  return new Error(`Invalid prepared manifest at ${manifestPath}: ${message}`);
}

function expectString(record: Record<string, unknown>, key: string, manifestPath: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidManifest(manifestPath, `missing non-empty string field '${key}'`);
  }
  return value;
}

function expectArray(
  record: Record<string, unknown>,
  key: string,
  manifestPath: string,
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw invalidManifest(manifestPath, `missing array field '${key}'`);
  }
  return value;
}

function expectBaseline(value: unknown, manifestPath: string): PreparedBaseline {
  if (!isRecord(value)) {
    throw invalidManifest(manifestPath, "missing object field 'baseline'");
  }
  const status = value.status;
  if (status !== 'initialized' && status !== 'unavailable') {
    throw invalidManifest(
      manifestPath,
      "field 'baseline.status' must be 'initialized' or 'unavailable'",
    );
  }
  const commit = value.commit;
  if (commit !== undefined && typeof commit !== 'string') {
    throw invalidManifest(manifestPath, "field 'baseline.commit' must be a string");
  }
  if (status === 'initialized' && (!commit || commit.trim().length === 0)) {
    throw invalidManifest(
      manifestPath,
      "field 'baseline.commit' is required when baseline.status is 'initialized'",
    );
  }
  return {
    status,
    ...(typeof commit === 'string' && commit.trim().length > 0 && { commit }),
  };
}

function fromManifestWire(value: unknown, manifestPath: string): PreparedManifest {
  if (!isRecord(value)) {
    throw invalidManifest(manifestPath, 'expected a JSON object');
  }
  if (value.schema_version !== 1) {
    throw invalidManifest(manifestPath, "field 'schema_version' must be 1");
  }
  const setupStatus = value.setup_status;
  if (setupStatus !== 'ok') {
    throw invalidManifest(manifestPath, "field 'setup_status' must be 'ok'");
  }

  const preparedDir = path.dirname(manifestPath);
  const resolveManifestPath = (rawPath: string) =>
    path.isAbsolute(rawPath) ? rawPath : path.resolve(preparedDir, rawPath);
  expectArray(value, 'setup_steps', manifestPath);
  expectArray(value, 'repo_pins', manifestPath);

  return {
    schemaVersion: 1,
    evalPath: resolveManifestPath(expectString(value, 'eval_path', manifestPath)),
    testId: expectString(value, 'test_id', manifestPath),
    target: expectString(value, 'target', manifestPath),
    workspacePath: resolveManifestPath(expectString(value, 'workspace_path', manifestPath)),
    promptPath: resolveManifestPath(expectString(value, 'prompt_path', manifestPath)),
    setupStatus,
    baseline: expectBaseline(value.baseline, manifestPath),
    createdAt: expectString(value, 'created_at', manifestPath),
    manifestPath,
    preparedDir,
  };
}

async function resolvePreparedManifestPath(preparedPath: string): Promise<string> {
  const resolved = path.resolve(preparedPath);
  try {
    const stats = await stat(resolved);
    return stats.isDirectory() ? path.join(resolved, 'agentv_prepare.json') : resolved;
  } catch {
    return path.basename(resolved) === 'agentv_prepare.json'
      ? resolved
      : path.join(resolved, 'agentv_prepare.json');
  }
}

async function readPreparedManifest(preparedPath: string): Promise<PreparedManifest> {
  const manifestPath = await resolvePreparedManifestPath(preparedPath);
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Prepared manifest not found at ${manifestPath}. Run agentv prepare first and pass --prepared <dir>.`,
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid prepared manifest JSON at ${manifestPath}: ${message}`);
  }
  return fromManifestWire(parsed, manifestPath);
}

async function ensureDirectoryExists(dirPath: string, description: string): Promise<void> {
  try {
    const stats = await stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error(`${description} is not a directory: ${dirPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${description} not found: ${dirPath}`);
    }
    throw error;
  }
}

async function ensureFileExists(filePath: string, description: string): Promise<void> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`${description} is not a file: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${description} not found: ${filePath}`);
    }
    throw error;
  }
}

function assertMatchesManifest(options: {
  readonly manifest: PreparedManifest;
  readonly evalPath: string;
  readonly testId?: string;
}): string {
  const commandEvalPath = path.resolve(options.evalPath);
  if (path.resolve(options.manifest.evalPath) !== commandEvalPath) {
    throw new Error(
      `Prepared manifest eval_path does not match command eval path: ${options.manifest.evalPath} !== ${commandEvalPath}`,
    );
  }
  if (options.testId && options.testId !== options.manifest.testId) {
    throw new Error(
      `Prepared manifest test_id '${options.manifest.testId}' does not match --test-id '${options.testId}'`,
    );
  }
  return options.testId ?? options.manifest.testId;
}

function toPreparedAttemptMetadata(
  manifest: PreparedManifest,
  tracePath: string | undefined,
): PreparedAttemptMetadata {
  return {
    source: 'manual',
    manifestPath: manifest.manifestPath,
    preparedDir: manifest.preparedDir,
    workspacePath: manifest.workspacePath,
    promptPath: manifest.promptPath,
    ...(tracePath !== undefined && { tracePath }),
    target: manifest.target,
    preparedAt: manifest.createdAt,
    setupStatus: manifest.setupStatus,
    baselineStatus: manifest.baseline.status,
    ...(manifest.baseline.commit !== undefined && { baselineCommit: manifest.baseline.commit }),
  };
}

function toCommandOutputWire(result: GradePreparedResult): GradePreparedResultWire {
  return {
    test_id: result.testId,
    target: result.target,
    score: result.score,
    execution_status: result.executionStatus,
    workspace_path: result.workspacePath,
    manifest_path: result.manifestPath,
    ...(result.tracePath !== undefined && { trace_path: result.tracePath }),
    output_dir: result.outputDir,
    index_path: result.indexPath,
  };
}

function printHumanOutput(result: GradePreparedResult): void {
  console.log(`Graded prepared attempt for ${result.testId} (${result.target})`);
  console.log(`Score: ${result.score.toFixed(3)} (${result.executionStatus})`);
  console.log(`Workspace: ${result.workspacePath}`);
  console.log(`Manifest: ${result.manifestPath}`);
  if (result.tracePath) {
    console.log(`Trace: ${result.tracePath}`);
  }
  console.log(`Artifact workspace: ${result.outputDir}`);
  console.log(`Index: ${result.indexPath}`);
}

function isTraceEnvelopeDocument(value: unknown): boolean {
  return isRecord(value) && value.schema_version === EXECUTION_TRACE_SCHEMA_VERSION;
}

function isTranscriptJsonLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.test_id === 'string' &&
    typeof value.target === 'string' &&
    typeof value.message_index === 'number' &&
    isRecord(value.source)
  );
}

function parseFirstJsonLine(raw: string): unknown | undefined {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return undefined;
  }
  try {
    return JSON.parse(firstLine);
  } catch {
    return undefined;
  }
}

function looksLikeTraceEnvelopeJsonText(trimmed: string): boolean {
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }
  return (
    trimmed.includes('"schema_version"') &&
    trimmed.includes(JSON.stringify(EXECUTION_TRACE_SCHEMA_VERSION))
  );
}

function traceEnvelopeRecordMatchesPreparedAttempt(
  record: Awaited<ReturnType<typeof readTraceEnvelopeReplayRecords>>[number],
  options: { readonly testId: string; readonly target: string },
): boolean {
  if (record.envelope.eval.testId !== options.testId) {
    return false;
  }
  const sourceTarget = record.envelope.eval.sourceTarget ?? record.envelope.eval.target;
  return sourceTarget === options.target || record.envelope.eval.target === options.target;
}

function selectTraceEnvelopeRecord(
  records: Awaited<ReturnType<typeof readTraceEnvelopeReplayRecords>>,
  options: { readonly sourcePath: string; readonly testId: string; readonly target: string },
) {
  if (records.length === 0) {
    throw new Error(`Trace file has no execution trace records: ${options.sourcePath}`);
  }
  const matchingTest = records.filter((record) => record.envelope.eval.testId === options.testId);
  const candidates = matchingTest.filter((record) =>
    traceEnvelopeRecordMatchesPreparedAttempt(record, options),
  );

  if (candidates.length === 1) {
    return candidates[0];
  }

  const detail =
    candidates.length === 0
      ? matchingTest.length === 0
        ? `no record matches test_id '${options.testId}'`
        : `${matchingTest.length} record(s) match test_id '${options.testId}' but none match target '${options.target}'`
      : `${candidates.length} records match test_id '${options.testId}' and target '${options.target}'`;
  throw new Error(
    `Trace file ${options.sourcePath} is ambiguous for prepared grading: ${detail}. Pass a single-record trace file or a file with one matching test/target record.`,
  );
}

function traceFromEnvelopeRecord(
  record: Awaited<ReturnType<typeof readTraceEnvelopeReplayRecords>>[number],
): Trace {
  const summary = traceEnvelopeToTraceSummary(record.envelope);
  return buildTraceFromMessages({
    output: traceEnvelopeToTranscriptMessages(record.envelope),
    summary: summary.trace,
    tokenUsage: summary.tokenUsage,
    costUsd: summary.costUsd,
    durationMs: summary.durationMs,
    startTime: summary.startTime,
    endTime: summary.endTime,
    provider: record.envelope.source.provider,
    target: record.envelope.eval.target,
    testId: record.envelope.eval.testId,
    conversationId: record.envelope.eval.runId,
    metadata: {
      trace_source_path: record.sourcePath,
      trace_source_format: EXECUTION_TRACE_SCHEMA_VERSION,
      trace_artifact_id: record.envelope.artifactId,
      ...(record.lineNumber !== undefined && { trace_source_line: record.lineNumber }),
    },
  });
}

function groupTranscriptLinesByTestTarget(
  lines: readonly TranscriptJsonLine[],
): TranscriptLineGroup[] {
  const groups = new Map<string, { testId: string; target: string; lines: TranscriptJsonLine[] }>();

  for (const line of lines) {
    const key = `${line.test_id}\0${line.target}`;
    const group =
      groups.get(key) ??
      (() => {
        const created = { testId: line.test_id, target: line.target, lines: [] };
        groups.set(key, created);
        return created;
      })();
    group.lines.push(line);
  }

  return [...groups.values()];
}

function selectTranscriptLines(
  lines: Awaited<ReturnType<typeof readTranscriptJsonl>>,
  options: { readonly sourcePath: string; readonly testId: string; readonly target: string },
) {
  const groups = groupTranscriptLinesByTestTarget(lines);
  if (groups.length === 0) {
    throw new Error(`Trace file has no transcript rows: ${options.sourcePath}`);
  }
  const matchingTest = groups.filter((group) => group.testId === options.testId);
  const candidates = matchingTest.filter((group) => group.target === options.target);

  if (candidates.length === 1) {
    return candidates[0].lines;
  }

  const detail =
    candidates.length === 0
      ? matchingTest.length === 0
        ? `no transcript group matches test_id '${options.testId}'`
        : `${matchingTest.length} transcript group(s) match test_id '${options.testId}' but none match target '${options.target}'`
      : `${candidates.length} transcript groups match test_id '${options.testId}' and target '${options.target}'`;
  throw new Error(
    `Trace file ${options.sourcePath} is ambiguous for prepared grading: ${detail}. Pass a single-session transcript or a transcript with one matching test/target group.`,
  );
}

async function readPreparedTrace(
  tracePath: string,
  options: { readonly testId: string; readonly target: string },
): Promise<PreparedTraceInput> {
  const sourcePath = path.resolve(tracePath);
  const raw = await readFile(sourcePath, 'utf8');
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`Trace file is empty: ${sourcePath}`);
  }

  const firstLine = parseFirstJsonLine(raw);
  if (isTraceEnvelopeDocument(firstLine)) {
    const records = await readTraceEnvelopeReplayRecords(sourcePath);
    return {
      sourcePath,
      trace: traceFromEnvelopeRecord(
        selectTraceEnvelopeRecord(records, { sourcePath, ...options }),
      ),
    };
  }

  if (isTranscriptJsonLine(firstLine)) {
    const lines = selectTranscriptLines(await readTranscriptJsonl(sourcePath), {
      sourcePath,
      ...options,
    });
    const trace = traceFromTranscriptJsonLines(lines);
    return {
      sourcePath,
      trace: {
        ...trace,
        metadata: {
          ...trace.metadata,
          trace_source_path: sourcePath,
          trace_source_format: 'agentv.transcript.jsonl',
        },
      },
    };
  }

  if (looksLikeTraceEnvelopeJsonText(trimmed)) {
    const records = await readTraceEnvelopeReplayRecords(sourcePath);
    return {
      sourcePath,
      trace: traceFromEnvelopeRecord(
        selectTraceEnvelopeRecord(records, { sourcePath, ...options }),
      ),
    };
  }

  throw new Error(
    `Unsupported trace format at ${sourcePath}. Expected agentv.trace.v1 JSON/JSONL or AgentV transcript JSONL.`,
  );
}

async function gradePreparedAttempt(options: {
  readonly evalPath: string;
  readonly testId?: string;
  readonly preparedPath: string;
  readonly outputDir?: string;
  readonly responsePath?: string;
  readonly tracePath?: string;
  readonly experiment?: string;
  readonly graderTarget?: string;
  readonly model?: string;
  readonly threshold?: number;
  readonly verbose?: boolean;
}): Promise<GradePreparedResult> {
  const manifest = await readPreparedManifest(options.preparedPath);
  const evalPath = path.resolve(options.evalPath);
  const testId = assertMatchesManifest({ manifest, evalPath, testId: options.testId });

  await ensureDirectoryExists(manifest.workspacePath, 'Prepared workspace');
  await ensureFileExists(manifest.promptPath, 'Prepared prompt');
  const preparedTrace =
    options.tracePath !== undefined
      ? await readPreparedTrace(options.tracePath, { testId, target: manifest.target })
      : undefined;

  const evalDir = path.dirname(evalPath);
  const repoRoot = await findRepoRoot(evalDir);
  await loadEnvFromHierarchy({ testFilePath: evalPath, repoRoot, verbose: !!options.verbose });

  const category = deriveCategory(path.relative(process.cwd(), evalPath));
  const suite = await loadTestSuite(evalPath, repoRoot, { category });
  const test = suite.tests.find((candidate) => candidate.id === testId);
  if (!test) {
    throw new Error(`Test ID '${testId}' not found in ${evalPath}`);
  }

  const selections = await selectMultipleTargets({
    testFilePath: evalPath,
    repoRoot,
    cwd: process.cwd(),
    dryRun: false,
    dryRunDelay: 0,
    dryRunDelayMin: 0,
    dryRunDelayMax: 0,
    env: process.env,
    targetNames: [manifest.target],
    targetRefs: suite.targetRefs,
  });
  const selection = selections[0];
  if (!selection) {
    throw new Error(`Target '${manifest.target}' could not be resolved`);
  }
  const target = {
    ...selection.resolvedTarget,
    name: manifest.target,
  } as ResolvedTarget;

  const response =
    options.responsePath !== undefined
      ? await readFile(path.resolve(options.responsePath), 'utf8')
      : undefined;
  const runDir = path.resolve(
    options.outputDir ?? buildDefaultRunDir(process.cwd(), options.experiment),
  );

  const result = await gradePreparedEvalCase({
    evalCase: test,
    target,
    targets: selection.definitions,
    env: process.env,
    evalFilePath: evalPath,
    workspacePath: manifest.workspacePath,
    baselineCommit: manifest.baseline.commit,
    response,
    trace: preparedTrace?.trace,
    verbose: options.verbose,
    graderTarget: options.graderTarget,
    model: options.model,
    threshold: options.threshold ?? suite.threshold,
    preparedAttempt: toPreparedAttemptMetadata(manifest, preparedTrace?.sourcePath),
  });

  const artifacts = await writeArtifactsFromResults([result], runDir, {
    evalFile: evalPath,
    experiment: options.experiment,
    plannedTestCount: 1,
    sourceTests: [test],
  });

  return {
    testId,
    target: manifest.target,
    score: result.score,
    executionStatus: result.executionStatus,
    workspacePath: manifest.workspacePath,
    manifestPath: manifest.manifestPath,
    tracePath: preparedTrace?.sourcePath,
    outputDir: runDir,
    indexPath: artifacts.indexPath,
  };
}

export const gradeCommand = command({
  name: 'grade',
  description: 'Grade a prepared workspace attempt without running the target provider',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval',
      description: 'Path to an eval file',
    }),
    testId: option({
      type: optional(string),
      long: 'test-id',
      description: 'Exact test ID to grade; defaults to agentv_prepare.json test_id',
    }),
    prepared: option({
      type: string,
      long: 'prepared',
      description: 'Prepared-attempt directory or agentv_prepare.json path',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description: 'Run artifact directory (writes index.jsonl and per-test artifacts)',
    }),
    response: option({
      type: optional(string),
      long: 'response',
      description: 'Optional final response text file from the human or external agent',
    }),
    trace: option({
      type: optional(string),
      long: 'trace',
      description:
        'Optional AgentV trace/session file for trace-aware graders (execution trace JSON/JSONL or transcript JSONL)',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Experiment label for canonical run output (default: default)',
    }),
    graderTarget: option({
      type: optional(string),
      long: 'grader-target',
      description:
        'Override grader target for all evaluators (e.g., "agentv", or a target name from targets.yaml)',
    }),
    model: option({
      type: optional(string),
      long: 'model',
      description: 'Override model for the grader target (e.g., "openai:gpt-5-mini")',
    }),
    threshold: option({
      type: optional(number),
      long: 'threshold',
      description: 'Per-test score threshold (0-1, default 0.8 or suite threshold)',
    }),
    format: option({
      type: optional(oneOf(['text', 'json'])),
      long: 'format',
      description: 'Output format: text (default) or json',
    }),
  },
  handler: async ({
    evalPath,
    testId,
    prepared,
    output,
    response,
    trace,
    experiment,
    graderTarget,
    model,
    threshold,
    format,
  }) => {
    const result = await gradePreparedAttempt({
      evalPath,
      testId,
      preparedPath: prepared,
      outputDir: output,
      responsePath: response,
      tracePath: trace,
      experiment,
      graderTarget,
      model,
      threshold,
      verbose: false,
    });
    if (format === 'json') {
      console.log(JSON.stringify(toCommandOutputWire(result), null, 2));
      return;
    }
    printHumanOutput(result);
  },
});
