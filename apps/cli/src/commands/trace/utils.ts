import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { EvaluationResult, TraceSummary } from '@agentv/core';
import { toCamelCaseDeep } from '@agentv/core';
import {
  RESULT_INDEX_FILENAME,
  RESULT_RUNS_DIRNAME,
  resolveExistingRunPrimaryPath,
  resolveWorkspaceOrFilePath,
} from '../eval/result-layout.js';
import { loadManifestResults } from '../results/manifest.js';

// ANSI color codes (no dependency needed)
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
export const c = noColor
  ? (Object.fromEntries(Object.keys(colors).map((k) => [k, ''])) as typeof colors)
  : colors;

// Regex to strip ANSI escape codes
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function stripAnsi(str: string): string {
  return str.replace(ansiPattern, '');
}

export function padRight(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return str + ' '.repeat(Math.max(0, len - plainLen));
}

export function padLeft(str: string, len: number): string {
  const plainLen = stripAnsi(str).length;
  return ' '.repeat(Math.max(0, len - plainLen)) + str;
}

/**
 * A raw JSONL result record with snake_case keys as stored on disk.
 */
export interface RawResult {
  timestamp?: string;
  test_id?: string;
  eval_id?: string;
  eval_set?: string;
  conversation_id?: string;
  score: number;
  assertions?: { text: string; passed: boolean; evidence?: string }[];
  target?: string;
  error?: string;
  scores?: RawEvaluatorScore[];
  trace?: RawTraceSummary;
  // Promoted execution metrics (snake_case from JSONL)
  token_usage?: { input: number; output: number; cached?: number };
  cost_usd?: number;
  duration_ms?: number;
  start_time?: string;
  end_time?: string;
  input?: unknown;
  output?: unknown;
  spans?: RawTraceSpan[];
  trials?: unknown[];
  aggregation?: unknown;
  file_changes?: string;
}

export interface RawEvaluatorScore {
  name: string;
  type: string;
  score: number;
  assertions?: { text: string; passed: boolean; evidence?: string }[];
  weight?: number;
}

export interface RawTraceSummary {
  event_count?: number;
  tool_calls?: Record<string, number>;
  error_count?: number;
  tool_durations?: Record<string, number[]>;
  llm_call_count?: number;
  // Execution metrics (present when trace includes provider metrics)
  token_usage?: { input: number; output: number; cached?: number };
  cost_usd?: number;
  duration_ms?: number;
}

export interface RawTraceSpan {
  type?: 'tool' | 'llm' | string;
  name: string;
  duration_ms?: number;
}

/**
 * Load all result or trace records from a supported source.
 *
 * Supported sources:
 * - Run workspace directories / index.jsonl manifests
 * - Legacy simple trace JSONL files
 * - OTLP JSON trace files written via --otel-file
 */
export function loadResultFile(filePath: string): RawResult[] {
  const resolvedFilePath = resolveTraceResultPath(filePath);

  if (path.extname(resolvedFilePath) === '.json') {
    return loadOtlpTraceFile(resolvedFilePath);
  }

  if (path.basename(resolvedFilePath) === RESULT_INDEX_FILENAME) {
    return loadManifestAsRawResults(resolvedFilePath);
  }

  return loadJsonlRecords(resolvedFilePath);
}

function resolveTraceResultPath(filePath: string): string {
  return resolveWorkspaceOrFilePath(filePath);
}

function loadJsonlRecords(filePath: string): RawResult[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  return lines.map((line, i) => {
    const record = JSON.parse(line) as RawResult;
    if (typeof record.score !== 'number') {
      throw new Error(`Missing or invalid score in result at line ${i + 1}: ${line.slice(0, 100)}`);
    }
    return record;
  });
}

function loadManifestAsRawResults(filePath: string): RawResult[] {
  return loadManifestResults(filePath).map(toRawResult);
}

function toRawResult(result: EvaluationResult): RawResult {
  return {
    timestamp: result.timestamp,
    test_id: result.testId,
    eval_set: result.eval_set,
    conversation_id: result.conversationId,
    score: result.score,
    assertions: result.assertions?.map((assertion) => ({
      text: assertion.text,
      passed: assertion.passed,
      evidence: assertion.evidence,
    })),
    target: result.target,
    error: result.error,
    scores: result.scores?.map((score) => ({
      name: score.name,
      type: score.type,
      score: score.score,
      assertions: score.assertions?.map((assertion) => ({
        text: assertion.text,
        passed: assertion.passed,
        evidence: assertion.evidence,
      })),
      weight: score.weight,
    })),
    token_usage: result.tokenUsage
      ? {
          input: result.tokenUsage.input,
          output: result.tokenUsage.output,
          cached: result.tokenUsage.cached,
        }
      : undefined,
    cost_usd: result.costUsd,
    duration_ms: result.durationMs,
    start_time: result.startTime,
    end_time: result.endTime,
    input: result.input,
    output: result.output,
    file_changes: result.fileChanges,
  };
}

type OtlpAttributeValue =
  | { stringValue?: string; intValue?: number | string; doubleValue?: number; boolValue?: boolean }
  | { arrayValue?: { values?: OtlpAttributeValue[] } };

interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

interface OtlpEvent {
  name?: string;
  attributes?: OtlpAttribute[];
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: OtlpAttribute[];
  status?: { code?: number; message?: string };
  events?: OtlpEvent[];
}

function loadOtlpTraceFile(filePath: string): RawResult[] {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
    resourceSpans?: { scopeSpans?: { spans?: OtlpSpan[] }[] }[];
  };

  const spans = parsed.resourceSpans
    ?.flatMap((resource) => resource.scopeSpans ?? [])
    .flatMap((scope) => scope.spans ?? []);

  if (!spans || spans.length === 0) {
    return [];
  }

  const spanMap = new Map<string, OtlpSpan>();
  const childMap = new Map<string, OtlpSpan[]>();

  for (const span of spans) {
    if (!span.spanId) continue;
    spanMap.set(span.spanId, span);
    if (span.parentSpanId) {
      const siblings = childMap.get(span.parentSpanId) ?? [];
      siblings.push(span);
      childMap.set(span.parentSpanId, siblings);
    }
  }

  const roots = spans.filter((span) => !span.parentSpanId || !spanMap.has(span.parentSpanId));
  const supportedRoots = roots.filter(isAgentvEvalRoot);
  const candidateRoots = supportedRoots.length > 0 ? supportedRoots : roots;

  return candidateRoots.map((root, index) => {
    const descendants = collectChildSpans(root.spanId, childMap);
    const rootAttrs = parseOtlpAttributes(root.attributes);
    const parsedDescendants = descendants.map((span) => ({
      ...span,
      parsedAttributes: parseOtlpAttributes(span.attributes),
    }));
    const toolSpans = parsedDescendants.filter(
      (span) => typeof span.parsedAttributes.gen_ai_tool_name === 'string',
    );
    const llmSpans = parsedDescendants.filter(
      (span) =>
        span.parsedAttributes.gen_ai_operation_name === 'chat' ||
        (typeof span.name === 'string' && span.name.startsWith('chat ')),
    );
    const tokenUsage = descendants.reduce(
      (acc, span) => {
        const attrs = parseOtlpAttributes(span.attributes);
        acc.input += numberAttr(attrs.gen_ai_usage_input_tokens) ?? 0;
        acc.output += numberAttr(attrs.gen_ai_usage_output_tokens) ?? 0;
        const cached = numberAttr(attrs.gen_ai_usage_cache_read_input_tokens);
        if (cached !== undefined && cached > 0) {
          acc.cached = (acc.cached ?? 0) + cached;
        }
        return acc;
      },
      { input: 0, output: 0, cached: undefined as number | undefined },
    );

    const traceSummary = buildDerivedTraceSummary({
      trace: {
        event_count:
          numberAttr(rootAttrs.agentv_trace_event_count) ??
          (toolSpans.length > 0 ? toolSpans.length : undefined),
        tool_calls: countRawSpanNames(
          toolSpans.map((span) => ({
            type: 'tool',
            name: String(span.parsedAttributes.gen_ai_tool_name),
          })),
        ),
        error_count: descendants.filter((span) => span.status?.code === 2).length || undefined,
        llm_call_count:
          numberAttr(rootAttrs.agentv_trace_llm_call_count) ??
          (llmSpans.length > 0 ? llmSpans.length : undefined),
      },
      spans: [
        ...llmSpans.map((span) => ({
          type: 'llm' as const,
          name: span.name ?? 'chat',
          duration_ms: durationFromSpan(span),
        })),
        ...toolSpans.map((span) => ({
          type: 'tool' as const,
          name: String(span.parsedAttributes.gen_ai_tool_name),
          duration_ms: durationFromSpan(span),
        })),
      ],
      duration_ms: numberAttr(rootAttrs.agentv_trace_duration_ms) ?? durationFromSpan(root),
      cost_usd: numberAttr(rootAttrs.agentv_trace_cost_usd),
      token_usage:
        tokenUsage.input ||
        tokenUsage.output ||
        tokenUsage.cached ||
        numberAttr(rootAttrs.agentv_trace_token_input) ||
        numberAttr(rootAttrs.agentv_trace_token_output) ||
        numberAttr(rootAttrs.agentv_trace_token_cached)
          ? {
              input: tokenUsage.input || numberAttr(rootAttrs.agentv_trace_token_input) || 0,
              output: tokenUsage.output || numberAttr(rootAttrs.agentv_trace_token_output) || 0,
              ...(tokenUsage.cached || numberAttr(rootAttrs.agentv_trace_token_cached)
                ? {
                    cached:
                      tokenUsage.cached || numberAttr(rootAttrs.agentv_trace_token_cached) || 0,
                  }
                : {}),
            }
          : undefined,
    });

    const score = numberAttr(rootAttrs.agentv_score);
    if (score === undefined) {
      throw new Error(
        `Unsupported OTLP trace root span at index ${index + 1}: missing agentv.score attribute`,
      );
    }

    return {
      test_id:
        stringAttr(rootAttrs.agentv_test_id) ??
        stringAttr(rootAttrs.agentv_eval_id) ??
        `trace-${index + 1}`,
      eval_set: stringAttr(rootAttrs.agentv_eval_set),
      target: stringAttr(rootAttrs.agentv_target),
      score,
      error: root.status?.code === 2 ? root.status.message : undefined,
      cost_usd: traceSummary?.cost_usd,
      duration_ms: traceSummary?.duration_ms,
      token_usage: traceSummary?.token_usage,
      trace: traceSummary
        ? {
            event_count: traceSummary.event_count,
            tool_calls: traceSummary.tool_calls,
            error_count: traceSummary.error_count,
            tool_durations: traceSummary.tool_durations,
            llm_call_count: traceSummary.llm_call_count,
            token_usage: traceSummary.token_usage,
            cost_usd: traceSummary.cost_usd,
            duration_ms: traceSummary.duration_ms,
          }
        : undefined,
      spans: traceSummary?.spans,
      output: stringAttr(rootAttrs.agentv_output_text),
      scores: root.events
        ?.filter(
          (event) =>
            event.name?.startsWith('agentv.grader.') || event.name?.startsWith('agentv.evaluator.'),
        )
        .map((event) => {
          const attrs = parseOtlpAttributes(event.attributes);
          const name =
            event.name?.replace(/^agentv\.grader\./, '').replace(/^agentv\.evaluator\./, '') ??
            'unknown';
          return {
            name,
            type:
              stringAttr(attrs.agentv_grader_type) ??
              stringAttr(attrs.agentv_evaluator_type) ??
              'unknown',
            score:
              numberAttr(attrs.agentv_grader_score) ??
              numberAttr(attrs.agentv_evaluator_score) ??
              0,
          };
        }),
    } satisfies RawResult;
  });
}

function isAgentvEvalRoot(span: OtlpSpan): boolean {
  const attrs = parseOtlpAttributes(span.attributes);
  return (
    span.name === 'agentv.eval' ||
    numberAttr(attrs.agentv_score) !== undefined ||
    typeof stringAttr(attrs.agentv_test_id) === 'string'
  );
}

function collectChildSpans(
  spanId: string | undefined,
  childMap: Map<string, OtlpSpan[]>,
): OtlpSpan[] {
  if (!spanId) return [];
  const direct = childMap.get(spanId) ?? [];
  const all = [...direct];
  for (const child of direct) {
    all.push(...collectChildSpans(child.spanId, childMap));
  }
  return all;
}

function parseOtlpAttributes(attributes: OtlpAttribute[] | undefined): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const attribute of attributes ?? []) {
    parsed[attribute.key.replace(/\./g, '_')] = parseOtlpValue(attribute.value);
  }
  return parsed;
}

function parseOtlpValue(value: OtlpAttributeValue | undefined): unknown {
  if (!value) return undefined;
  if ('stringValue' in value && value.stringValue !== undefined) return value.stringValue;
  if ('intValue' in value && value.intValue !== undefined) return Number(value.intValue);
  if ('doubleValue' in value && value.doubleValue !== undefined) return value.doubleValue;
  if ('boolValue' in value && value.boolValue !== undefined) return value.boolValue;
  if ('arrayValue' in value)
    return (value.arrayValue?.values ?? []).map((entry) => parseOtlpValue(entry));
  return undefined;
}

function durationFromSpan(
  span: Pick<OtlpSpan, 'startTimeUnixNano' | 'endTimeUnixNano'>,
): number | undefined {
  const start = Number(span.startTimeUnixNano);
  const end = Number(span.endTimeUnixNano);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.round((end - start) / 1_000_000);
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberAttr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface DerivedTraceSummary extends RawTraceSummary {
  spans?: RawTraceSpan[];
}

export function buildDerivedTraceSummary(result: {
  trace?: RawTraceSummary;
  spans?: RawTraceSpan[];
  token_usage?: RawResult['token_usage'];
  cost_usd?: number;
  duration_ms?: number;
}): DerivedTraceSummary | undefined {
  const toolSpans = (result.spans ?? []).filter((span) => span.type === 'tool');
  const llmSpans = (result.spans ?? []).filter((span) => span.type === 'llm');
  const toolCalls = result.trace?.tool_calls ?? countRawSpanNames(toolSpans);
  const toolDurations = result.trace?.tool_durations ?? groupRawSpanDurations(toolSpans);
  const hasSpanData = (result.spans?.length ?? 0) > 0;
  const eventCount = result.trace?.event_count ?? (hasSpanData ? toolSpans.length : undefined);
  const llmCallCount = result.trace?.llm_call_count ?? (hasSpanData ? llmSpans.length : undefined);

  if (
    !result.trace &&
    !result.spans?.length &&
    result.token_usage === undefined &&
    result.cost_usd === undefined &&
    result.duration_ms === undefined
  ) {
    return undefined;
  }

  return {
    event_count: eventCount,
    tool_calls: toolCalls,
    error_count: result.trace?.error_count,
    tool_durations: toolDurations,
    llm_call_count: llmCallCount,
    token_usage: result.trace?.token_usage ?? result.token_usage,
    cost_usd: result.trace?.cost_usd ?? result.cost_usd,
    duration_ms: result.trace?.duration_ms ?? result.duration_ms,
    spans: result.spans,
  };
}

function countRawSpanNames(spans: RawTraceSpan[]): Record<string, number> | undefined {
  const counts: Record<string, number> = {};
  for (const span of spans) {
    counts[span.name] = (counts[span.name] ?? 0) + 1;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function groupRawSpanDurations(spans: RawTraceSpan[]): Record<string, number[]> | undefined {
  const grouped: Record<string, number[]> = {};
  for (const span of spans) {
    if (span.duration_ms === undefined) continue;
    const existing = grouped[span.name] ?? [];
    existing.push(span.duration_ms);
    grouped[span.name] = existing;
  }
  return Object.keys(grouped).length > 0 ? grouped : undefined;
}

export function getTraceSummary(result: RawResult): RawTraceSummary | undefined {
  const derived = buildDerivedTraceSummary(result);
  if (!derived) return undefined;
  const { spans: _spans, ...trace } = derived;
  return trace;
}

export function getTraceSpans(result: RawResult): RawTraceSpan[] {
  return buildDerivedTraceSummary(result)?.spans ?? [];
}

export function toTraceSummary(result: RawResult): TraceSummary | undefined {
  const rawTrace = getTraceSummary(result);
  if (!rawTrace) return undefined;
  return toCamelCaseDeep(rawTrace) as TraceSummary;
}

/**
 * Metadata about a result file for listing.
 */
export interface ResultFileMeta {
  path: string;
  filename: string;
  timestamp: string;
  testCount: number;
  passRate: number;
  avgScore: number;
  sizeBytes: number;
}

/**
 * Enumerate result files in the .agentv/results/ directory.
 * Scans runs/ for both directory-per-run layouts (index.jsonl preferred inside subdirs)
 * and legacy flat .jsonl files. Also scans the base directory for pre-runs/ files.
 */
export function listResultFiles(cwd: string, limit?: number): ResultFileMeta[] {
  const baseDir = path.join(cwd, '.agentv', 'results');
  const runsDir = path.join(baseDir, RESULT_RUNS_DIRNAME);

  const files: { filePath: string; displayName: string }[] = [];

  // Scan runs/ for both directory-based runs and flat JSONL files.
  // Process directories first so they take priority in dedup over flat files.
  try {
    const entries = readdirSync(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const primaryPath = resolveExistingRunPrimaryPath(path.join(runsDir, entry.name));
        if (primaryPath) {
          files.push({ filePath: primaryPath, displayName: entry.name });
        }
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && entry.name.endsWith('.jsonl')) {
        files.push({ filePath: path.join(runsDir, entry.name), displayName: entry.name });
      }
    }
  } catch {
    // runs/ doesn't exist yet
  }

  // Also scan base directory for legacy files (backward compat)
  try {
    const entries = readdirSync(baseDir).filter((f) => f.endsWith('.jsonl'));
    for (const entry of entries) {
      files.push({ filePath: path.join(baseDir, entry), displayName: entry });
    }
  } catch {
    // Base directory doesn't exist yet
  }

  // Deduplicate by normalized name (strip .jsonl so dir "eval_X" matches file "eval_X.jsonl")
  const seen = new Set<string>();
  const uniqueFiles: { filePath: string; displayName: string }[] = [];
  for (const file of files) {
    const key = file.displayName.replace(/\.jsonl$/, '');
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFiles.push(file);
    }
  }

  // Sort by display name descending (most recent first)
  uniqueFiles.sort((a, b) => b.displayName.localeCompare(a.displayName));

  const limited = limit !== undefined && limit > 0 ? uniqueFiles.slice(0, limit) : uniqueFiles;

  const metas: ResultFileMeta[] = [];

  for (const { filePath, displayName } of limited) {
    try {
      const fileStat = statSync(filePath);
      const results = loadResultFile(filePath);

      const testCount = results.length;
      const passCount = results.filter((r) => r.score >= 1.0).length;
      const passRate = testCount > 0 ? passCount / testCount : 0;
      const avgScore = testCount > 0 ? results.reduce((sum, r) => sum + r.score, 0) / testCount : 0;

      const filenameTimestamp = extractTimestampFromFilename(displayName);
      const timestamp = filenameTimestamp ?? results[0]?.timestamp ?? 'unknown';

      metas.push({
        path: filePath,
        filename: displayName,
        timestamp,
        testCount,
        passRate,
        avgScore,
        sizeBytes: fileStat.size,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return metas;
}

/**
 * Extract ISO timestamp from eval filename like eval_2026-02-20T21-38-05-833Z.jsonl
 */
export function extractTimestampFromFilename(filename: string): string | undefined {
  const match = filename.match(/eval_(\d{4}-\d{2}-\d{2}T[\d-]+Z)/);
  if (!match) return undefined;
  // Re-convert dashes back to colons/dots for display
  return match[1].replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');
}

/**
 * Format a number with commas for display.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format duration in ms to human-readable.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m${seconds}s`;
}

/**
 * Format cost in USD.
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

/**
 * Format file size for display.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Format a score as percentage.
 */
export function formatScore(score: number): string {
  return `${(score * 100).toFixed(0)}%`;
}
