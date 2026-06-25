/**
 * Eval detail view with checks, source traceability, artifact files, and feedback.
 *
 * Layout: compact header → tabs → full-height content area.
 * Scores and assertions are only visible in the Checks tab.
 * Assertions are grouped by grader name.
 */

import { useEffect, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import {
  artifactFileContentUrl,
  isPassing,
  projectEvalFileContentOptions,
  projectEvalFilesOptions,
  projectEvalTranscriptOptions,
  useEvalFileContent,
  useEvalFiles,
  useEvalTranscript,
  useStudioConfig,
} from '~/lib/api';
import type { RepeatRunGroup } from '~/lib/result-table';
import type {
  AssertionEntry,
  EvalCaseRun,
  EvalResult,
  ScoreEntry,
  SourceCapturedFile,
  SourceReferencedFile,
  SourceTraceability,
} from '~/lib/types';

import { FeedbackPanel } from './FeedbackPanel';
import type { FileNode } from './FileTree';
import { FileTree } from './FileTree';
import { MonacoViewer } from './MonacoViewer';
import { ScoreBar } from './ScoreBar';
import { TranscriptTimeline, parseTranscriptJsonl } from './TranscriptTimeline';

interface EvalDetailProps {
  eval: EvalResult;
  runId: string;
  projectId?: string;
  repeatGroup?: RepeatRunGroup;
  selectedCaseRun?: EvalCaseRun | null;
  initialTab?: Tab;
  initialSelectedFilePath?: string | null;
  onSelectCaseRun?: (caseRun: EvalCaseRun, initialTab?: Tab) => void;
}

type Tab = 'checks' | 'transcript' | 'source' | 'files' | 'feedback';

/** Recursively find the first file node in the tree. */
function findFirstFile(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') return node.path;
    if (node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

function caseRunPath(caseRun: EvalCaseRun, index = 0): string {
  return caseRun.run_path ?? `run-${caseRun.run ?? index + 1}`;
}

function caseRunTokenTotal(caseRun: EvalCaseRun): number | undefined {
  if (caseRun.total_tokens != null) return caseRun.total_tokens;
  const usage = caseRun.token_usage;
  if (!usage) return undefined;
  const values = [usage.input, usage.output, usage.reasoning, usage.cached].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function formatPercent(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs == null) return '-';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCost(costUsd: number | undefined): string | undefined {
  if (costUsd == null) return undefined;
  if (costUsd === 0) return '$0';
  if (costUsd < 0.01) return `$${costUsd.toFixed(5)}`;
  return `$${costUsd.toFixed(4)}`;
}

function formatTokens(tokens: number | undefined): string | undefined {
  if (tokens == null) return undefined;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}

function selectedRunResult(result: EvalResult, caseRun: EvalCaseRun): EvalResult {
  return {
    ...result,
    score: caseRun.score ?? result.score,
    executionStatus: caseRun.execution_status ?? result.executionStatus,
    error: caseRun.error,
    costUsd: caseRun.cost_usd ?? result.costUsd,
    durationMs: caseRun.duration_ms ?? result.durationMs,
    scores: caseRun.scores,
    assertions: caseRun.assertions,
    runs: undefined,
    aggregation: undefined,
    grading_path: caseRun.grading_path,
    timing_path: caseRun.timing_path,
    metrics_path: caseRun.metrics_path,
    transcript_path: caseRun.transcript_path,
    output_path: caseRun.answer_path,
    answer_path: caseRun.answer_path,
  };
}

export function EvalDetail({
  eval: result,
  runId,
  projectId,
  repeatGroup,
  selectedCaseRun = null,
  initialTab = 'checks',
  initialSelectedFilePath = null,
  onSelectCaseRun,
}: EvalDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialSelectedFilePath);
  const { data: config } = useStudioConfig(projectId);
  const isReadOnly = config?.read_only === true;
  const detailResult = selectedCaseRun ? selectedRunResult(result, selectedCaseRun) : result;
  const showAggregateRepeat = repeatGroup != null && selectedCaseRun == null;

  useEffect(() => {
    setActiveTab(initialTab);
    setSelectedFilePath(initialSelectedFilePath);
  }, [initialTab, initialSelectedFilePath]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'checks', label: 'Checks' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'source', label: 'Source' },
    { id: 'files', label: 'Files' },
    ...(isReadOnly ? [] : [{ id: 'feedback' as const, label: 'Feedback' }]),
  ];

  const openFile = (filePath: string) => {
    setSelectedFilePath(filePath);
    setActiveTab('files');
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* Tab navigation — at the top so Files tab editor fills maximum height */}
      <div className="border-b border-gray-800">
        <div className="flex gap-1 px-4">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-cyan-400 text-cyan-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        {activeTab === 'checks' && (
          <div className="overflow-auto p-4">
            {showAggregateRepeat ? (
              <RepeatAggregateChecksTab
                result={result}
                group={repeatGroup}
                onSelectCaseRun={onSelectCaseRun}
              />
            ) : selectedCaseRun ? (
              <RunChecksTab
                result={detailResult}
                caseRun={selectedCaseRun}
                runId={runId}
                projectId={projectId}
                onOpenFile={openFile}
              />
            ) : (
              <ChecksTab result={detailResult} projectId={projectId} />
            )}
          </div>
        )}
        {activeTab === 'files' && (
          <div className="h-full p-4">
            <FilesTab
              result={detailResult}
              runId={runId}
              projectId={projectId}
              selectedPath={selectedFilePath}
              onSelectedPathChange={setSelectedFilePath}
            />
          </div>
        )}
        {activeTab === 'transcript' && (
          <div className="overflow-auto p-4">
            {showAggregateRepeat ? (
              <RepeatAggregateTranscriptTab
                result={result}
                group={repeatGroup}
                runId={runId}
                projectId={projectId}
                onSelectCaseRun={onSelectCaseRun}
              />
            ) : selectedCaseRun ? (
              <RunTranscriptTab
                result={detailResult}
                caseRun={selectedCaseRun}
                runId={runId}
                projectId={projectId}
                onOpenFile={openFile}
              />
            ) : (
              <TranscriptTab
                result={detailResult}
                runId={runId}
                projectId={projectId}
                onOpenFile={openFile}
              />
            )}
          </div>
        )}
        {activeTab === 'source' && (
          <div className="overflow-auto p-4">
            <SourceTab result={detailResult} />
          </div>
        )}
        {!isReadOnly && activeTab === 'feedback' && (
          <div className="p-4">
            <FeedbackPanel testId={detailResult.testId} projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function SourceMetaRow({ label, value }: { label: string; value?: string | number | boolean }) {
  if (value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-gray-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-sm text-gray-200">{String(value)}</dd>
    </div>
  );
}

function SourceFileSummary({ file }: { file: SourceCapturedFile }) {
  const size = formatBytes(file.size_bytes);
  return (
    <dl className="grid gap-3 md:grid-cols-2">
      <SourceMetaRow label="Path" value={file.display_path} />
      <SourceMetaRow label="SHA-256" value={file.content_sha256} />
      <SourceMetaRow label="Size" value={size} />
      <SourceMetaRow label="Omitted" value={file.omitted?.message ?? file.omitted?.reason} />
    </dl>
  );
}

function SourceCodeBlock({ value, language }: { value: string; language?: string }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md border border-gray-800 bg-gray-950 p-3 text-xs text-gray-200">
      <code data-language={language}>{value}</code>
    </pre>
  );
}

function SourceReferencedFileItem({ file }: { file: SourceReferencedFile }) {
  const title = `${file.kind}${file.grader_name ? ` · ${file.grader_name}` : ''}`;
  return (
    <details className="rounded-md border border-gray-800 bg-gray-900 p-3" open={false}>
      <summary className="cursor-pointer text-sm font-medium text-gray-200">
        <span>{title}</span>
        <span className="ml-3 font-mono text-xs text-gray-500">{file.display_path}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <SourceFileSummary file={file} />
        {file.command && file.command.length > 0 && (
          <SourceCodeBlock value={JSON.stringify(file.command, null, 2)} language="json" />
        )}
        {file.content && <SourceCodeBlock value={file.content} />}
      </div>
    </details>
  );
}

function SourceTab({ result }: { result: EvalResult }) {
  const traceability: SourceTraceability | undefined = result.source_traceability;
  if (!traceability || traceability.status !== 'captured') {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h4 className="text-sm font-medium text-gray-300">Source metadata</h4>
        <p className="mt-2 text-sm text-gray-500">
          {traceability?.message ?? 'Source metadata was not captured for this run.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-300">Traceability</h4>
        <dl className="grid gap-3 md:grid-cols-2">
          <SourceMetaRow label="Eval file" value={traceability.eval_file?.display_path} />
          <SourceMetaRow label="Test ID" value={traceability.test_id ?? result.testId} />
          <SourceMetaRow label="Suite" value={result.suite} />
          <SourceMetaRow label="Category" value={result.category} />
          <SourceMetaRow label="Target" value={result.target} />
        </dl>
      </section>

      {traceability.source_test?.yaml && (
        <section className="space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Source Test</h4>
          <SourceCodeBlock value={traceability.source_test.yaml} language="yaml" />
        </section>
      )}

      {traceability.eval_file?.content && (
        <section className="space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Eval File Snapshot</h4>
          <SourceFileSummary file={traceability.eval_file} />
          <SourceCodeBlock value={traceability.eval_file.content} language="yaml" />
        </section>
      )}

      {traceability.graders && traceability.graders.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Graders</h4>
          <div className="space-y-3">
            {traceability.graders.map((grader) => (
              <details
                key={`${grader.name}-${grader.type}`}
                className="rounded-md border border-gray-800 bg-gray-900 p-3"
              >
                <summary className="cursor-pointer text-sm font-medium text-gray-200">
                  {grader.name}
                  <span className="ml-3 font-mono text-xs text-gray-500">{grader.type}</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <dl className="grid gap-3 md:grid-cols-3">
                    <SourceMetaRow label="Weight" value={grader.weight} />
                    <SourceMetaRow label="Required" value={grader.required} />
                    <SourceMetaRow label="Min score" value={grader.min_score} />
                  </dl>
                  <SourceCodeBlock
                    value={JSON.stringify(grader.definition, null, 2)}
                    language="json"
                  />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {traceability.referenced_files && traceability.referenced_files.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-sm font-medium text-gray-300">Referenced Files</h4>
          <div className="space-y-3">
            {traceability.referenced_files.map((file, index) => (
              <SourceReferencedFileItem
                key={`${file.kind}-${file.display_path}-${file.grader_name ?? ''}-${index}`}
                file={file}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** A single assertion row. */
function AssertionCard({ assertion }: { assertion: AssertionEntry }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        assertion.passed
          ? 'border-emerald-900/50 bg-emerald-950/20'
          : 'border-red-900/50 bg-red-950/20'
      }`}
    >
      <span className={`mt-0.5 text-lg ${assertion.passed ? 'text-emerald-400' : 'text-red-400'}`}>
        {assertion.passed ? '\u2713' : '\u2717'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-200">
          {assertion.text}
          {assertion.durationMs != null && (
            <span className="ml-2 text-xs text-gray-500">
              ({(assertion.durationMs / 1000).toFixed(1)}s)
            </span>
          )}
        </p>
        {assertion.evidence && <p className="mt-1 text-xs text-gray-400">{assertion.evidence}</p>}
      </div>
    </div>
  );
}

/**
 * Checks tab: overall score → per-grader scores → assertions → failure reasons.
 * Assertions are grouped by evaluator when per-score assertion data is available.
 */
function ChecksTab({ result, projectId }: { result: EvalResult; projectId?: string }) {
  const { data: config } = useStudioConfig(projectId);
  const passThreshold = config?.threshold ?? config?.pass_threshold ?? 0.8;

  const hasFailed =
    !isPassing(result.score, passThreshold) ||
    result.executionStatus === 'error' ||
    result.executionStatus === 'failed';

  // Determine how to render assertions:
  // If any score entry has nested assertions, use per-score grouping (enables grader pills).
  // Otherwise fall back to the top-level assertions array.
  const scoresWithAssertions = (result.scores ?? []).filter(
    (s): s is ScoreEntry & { assertions: AssertionEntry[] } =>
      Array.isArray(s.assertions) && s.assertions.length > 0,
  );
  const useGrouped = scoresWithAssertions.length > 0;
  const topLevelAssertions = result.assertions ?? [];

  // Collect failure reasons
  const failureReasons: string[] = [];
  if (result.error) failureReasons.push(result.error);
  if (result.executionStatus === 'error' || result.executionStatus === 'failed') {
    failureReasons.push(`Execution status: ${result.executionStatus}`);
  }
  const assertionsForFailures = useGrouped
    ? scoresWithAssertions.flatMap((s) => s.assertions)
    : topLevelAssertions;
  for (const a of assertionsForFailures.filter((a) => !a.passed)) {
    const msg = a.evidence ? `${a.text}: ${a.evidence}` : a.text;
    failureReasons.push(msg);
  }
  if (result.scores) {
    for (const s of result.scores) {
      if (!isPassing(s.score, passThreshold) && s.details) {
        const detailStr =
          typeof s.details === 'string' ? s.details : JSON.stringify(s.details, null, 2);
        failureReasons.push(`[${s.name ?? s.type ?? 'evaluator'}] ${detailStr}`);
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Overall score */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-400">Overall score</span>
          <div className="flex-1">
            <ScoreBar score={result.score} />
          </div>
        </div>
      </div>

      {/* Per-grader scores */}
      {result.scores && result.scores.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-400">Grader Scores</h4>
          <div className="space-y-3">
            {result.scores.map((s, i) => (
              <div key={`${s.name ?? s.type ?? i}`} className="flex items-center gap-4">
                <span className="w-40 truncate text-sm text-gray-300">
                  {s.name ?? s.type ?? `Score ${i + 1}`}
                </span>
                <div className="flex-1">
                  <ScoreBar score={s.score} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assertions */}
      {useGrouped ? (
        <div className="space-y-6">
          {scoresWithAssertions.map((s, si) => {
            const graderLabel = s.name ?? s.type ?? `Grader ${si + 1}`;
            return (
              <div key={`${s.name ?? s.type ?? si}`} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                  {graderLabel}
                </h4>
                {s.assertions.map((a, ai) => (
                  <AssertionCard key={`${a.text}-${ai}`} assertion={a} />
                ))}
              </div>
            );
          })}
        </div>
      ) : topLevelAssertions.length > 0 ? (
        <div className="space-y-2">
          {topLevelAssertions.map((a, i) => (
            <AssertionCard key={`${a.text}-${i}`} assertion={a} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No assertion steps recorded.</p>
      )}

      {/* Failure reasons */}
      {hasFailed && failureReasons.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <h4 className="mb-2 text-sm font-medium text-red-400">Failure Reason</h4>
          <div className="space-y-2">
            {failureReasons.map((reason) => (
              <p key={reason} className="text-sm text-gray-300">
                {reason}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RunMetricRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="min-w-0 rounded-md border border-gray-800 bg-gray-950/50 px-3 py-2">
      <div className="text-xs font-medium uppercase text-gray-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-gray-200">{value ?? '-'}</div>
    </div>
  );
}

function RunActionRow({
  caseRun,
  index,
  onSelectCaseRun,
}: {
  caseRun: EvalCaseRun;
  index: number;
  onSelectCaseRun?: (caseRun: EvalCaseRun, initialTab?: Tab) => void;
}) {
  const runLabel = caseRunPath(caseRun, index);
  const passed = caseRun.verdict === 'pass' || (caseRun.score ?? 0) >= 0.8;
  const cost = formatCost(caseRun.cost_usd);
  const tokens = formatTokens(caseRunTokenTotal(caseRun));
  return (
    <div className="grid gap-2 rounded-md border border-gray-800 bg-gray-950/50 p-3 text-sm md:grid-cols-[minmax(8rem,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={passed ? 'text-emerald-300' : 'text-red-300'}>
            {passed ? '\u2713' : '\u2717'}
          </span>
          <span className="truncate font-medium text-gray-200" title={runLabel}>
            {runLabel}
          </span>
          <span className="tabular-nums text-gray-500">{formatPercent(caseRun.score)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          <span>{formatDuration(caseRun.duration_ms)}</span>
          {cost ? <span>{cost}</span> : null}
          {tokens ? <span>{tokens}</span> : null}
          {caseRun.total_tool_calls != null ? (
            <span>{caseRun.total_tool_calls} tool calls</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <button
          type="button"
          onClick={() => onSelectCaseRun?.(caseRun, 'checks')}
          className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:border-cyan-900/60 hover:text-cyan-300"
        >
          Checks
        </button>
        <button
          type="button"
          onClick={() => onSelectCaseRun?.(caseRun, 'transcript')}
          className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:border-cyan-900/60 hover:text-cyan-300"
        >
          Transcript
        </button>
      </div>
    </div>
  );
}

function RepeatAggregateChecksTab({
  result,
  group,
  onSelectCaseRun,
}: {
  result: EvalResult;
  group: RepeatRunGroup;
  onSelectCaseRun?: (caseRun: EvalCaseRun, initialTab?: Tab) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-400">Mean score</span>
          <div className="flex-1">
            <ScoreBar score={group.meanScore} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <RunMetricRow label="Run success" value={`${group.passedRuns}/${group.runCount}`} />
        <RunMetricRow label="Mean duration" value={formatDuration(group.meanDurationMs)} />
        <RunMetricRow
          label="Assertions"
          value={
            group.assertionCount > 0
              ? `${group.passedAssertions}/${group.assertionCount} (${formatPercent(group.assertionPassRate)})`
              : 'Not recorded'
          }
        />
      </div>

      {result.scores && result.scores.length > 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-400">Aggregate Grader Scores</h4>
          <div className="space-y-3">
            {result.scores.map((score, index) => (
              <div key={`${score.name ?? score.type ?? index}`} className="flex items-center gap-4">
                <span className="w-40 truncate text-sm text-gray-300">
                  {score.name ?? score.type ?? `Score ${index + 1}`}
                </span>
                <div className="flex-1">
                  <ScoreBar score={score.score} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-300">Runs</h4>
        {group.runs.map((caseRun, index) => (
          <RunActionRow
            key={caseRunPath(caseRun, index)}
            caseRun={caseRun}
            index={index}
            onSelectCaseRun={onSelectCaseRun}
          />
        ))}
      </section>
    </div>
  );
}

type ParsedGradingArtifact = {
  assertions: AssertionEntry[];
  summary?: {
    passed?: number;
    failed?: number;
    total?: number;
    pass_rate?: number;
  };
  error?: string;
};

function parseGradingArtifact(content: string | undefined): ParsedGradingArtifact | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const rawAssertions = Array.isArray(parsed.assertions) ? parsed.assertions : [];
    const assertions = rawAssertions.flatMap((value): AssertionEntry[] => {
      if (!value || typeof value !== 'object') return [];
      const assertion = value as Record<string, unknown>;
      if (typeof assertion.text !== 'string' || typeof assertion.passed !== 'boolean') {
        return [];
      }
      return [
        {
          text: assertion.text,
          passed: assertion.passed,
          evidence: typeof assertion.evidence === 'string' ? assertion.evidence : undefined,
        },
      ];
    });
    const summary =
      parsed.summary && typeof parsed.summary === 'object' ? parsed.summary : undefined;
    return { assertions, summary: summary as ParsedGradingArtifact['summary'] };
  } catch (error) {
    return { assertions: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function RunChecksTab({
  result,
  caseRun,
  runId,
  projectId,
  onOpenFile,
}: {
  result: EvalResult;
  caseRun: EvalCaseRun;
  runId: string;
  projectId?: string;
  onOpenFile: (path: string) => void;
}) {
  const gradingPath = caseRun.grading_path;
  const artifactDir = result.artifact_dir;
  const evalId = result.testId;
  const { data: gradingContent, isLoading } =
    projectId && gradingPath
      ? useQuery(projectEvalFileContentOptions(projectId, runId, evalId, gradingPath, artifactDir))
      : useEvalFileContent(runId, evalId, gradingPath ?? '', artifactDir);
  const parsed = parseGradingArtifact(gradingContent?.content);

  if (!gradingPath) {
    return <ChecksTab result={result} projectId={projectId} />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-400">Run score</span>
          <div className="flex-1">
            <ScoreBar score={result.score} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <RunMetricRow label="Duration" value={formatDuration(caseRun.duration_ms)} />
        <RunMetricRow label="Cost" value={formatCost(caseRun.cost_usd)} />
        <RunMetricRow label="Tokens" value={formatTokens(caseRunTokenTotal(caseRun))} />
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-medium text-gray-400">Grading</h4>
          <button
            type="button"
            onClick={() => onOpenFile(gradingPath)}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-cyan-900/60 hover:text-cyan-300"
          >
            Open grading JSON
          </button>
        </div>
        {isLoading ? (
          <p className="mt-3 text-sm text-gray-500">Loading grading artifact...</p>
        ) : null}
        {parsed?.error ? <p className="mt-3 text-sm text-red-300">{parsed.error}</p> : null}
        {parsed?.summary ? (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <RunMetricRow
              label="Assertion pass rate"
              value={formatPercent(parsed.summary.pass_rate)}
            />
            <RunMetricRow label="Passed" value={String(parsed.summary.passed ?? 0)} />
            <RunMetricRow label="Failed" value={String(parsed.summary.failed ?? 0)} />
          </div>
        ) : null}
      </div>

      {parsed && parsed.assertions.length > 0 ? (
        <div className="space-y-2">
          {parsed.assertions.map((assertion, index) => (
            <AssertionCard key={`${assertion.text}-${index}`} assertion={assertion} />
          ))}
        </div>
      ) : !isLoading ? (
        <p className="text-sm text-gray-500">No assertion steps recorded in grading.json.</p>
      ) : null}
    </div>
  );
}

function containsFilePath(nodes: FileNode[], filePath: string | null): boolean {
  if (!filePath) return false;
  for (const node of nodes) {
    if (node.type === 'file' && node.path === filePath) return true;
    if (node.children && containsFilePath(node.children, filePath)) return true;
  }
  return false;
}

function RepeatAggregateTranscriptTab({
  result,
  group,
  runId,
  projectId,
  onSelectCaseRun,
}: {
  result: EvalResult;
  group: RepeatRunGroup;
  runId: string;
  projectId?: string;
  onSelectCaseRun?: (caseRun: EvalCaseRun, initialTab?: Tab) => void;
}) {
  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
        Run transcripts
      </h4>
      {group.runs.map((caseRun, index) => {
        const runLabel = caseRunPath(caseRun, index);
        const transcriptPath = caseRun.transcript_path;
        const transcriptHref = transcriptPath
          ? artifactFileContentUrl({
              projectId,
              runId,
              evalId: result.testId,
              filePath: transcriptPath,
              artifactDir: result.artifact_dir,
              raw: true,
            })
          : undefined;
        return (
          <div
            key={runLabel}
            className="grid gap-2 rounded-md border border-gray-800 bg-gray-950/50 p-3 text-sm md:grid-cols-[minmax(8rem,1fr)_auto] md:items-center"
          >
            <div className="min-w-0">
              <div className="font-medium text-gray-200">{runLabel}</div>
              <div className="mt-1 truncate font-mono text-xs text-gray-500" title={transcriptPath}>
                {transcriptPath ?? 'No transcript artifact'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => onSelectCaseRun?.(caseRun, 'transcript')}
                disabled={!transcriptPath}
                className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:border-cyan-900/60 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                View
              </button>
              {transcriptHref ? (
                <a
                  href={transcriptHref}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md px-2.5 py-1 text-xs text-cyan-400 transition-colors hover:text-cyan-300 hover:underline"
                >
                  Raw
                </a>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function RunTranscriptTab({
  result,
  caseRun,
  runId,
  projectId,
  onOpenFile,
}: {
  result: EvalResult;
  caseRun: EvalCaseRun;
  runId: string;
  projectId?: string;
  onOpenFile: (path: string) => void;
}) {
  const evalId = result.testId;
  const artifactDir = result.artifact_dir;
  const transcriptPath = caseRun.transcript_path;
  const answerPath = caseRun.answer_path;
  const { data: transcriptContent, isLoading: isLoadingTranscript } =
    projectId && transcriptPath
      ? useQuery(
          projectEvalFileContentOptions(projectId, runId, evalId, transcriptPath, artifactDir),
        )
      : useEvalFileContent(runId, evalId, transcriptPath ?? '', artifactDir);
  const { data: answerContent } =
    projectId && answerPath
      ? useQuery(projectEvalFileContentOptions(projectId, runId, evalId, answerPath, artifactDir))
      : useEvalFileContent(runId, evalId, answerPath ?? '', artifactDir);

  const transcriptValue = transcriptContent?.content ?? '';
  const parsedTranscript = useMemo(() => parseTranscriptJsonl(transcriptValue), [transcriptValue]);

  if (!transcriptPath) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="text-sm font-medium text-gray-300">No structured transcript</h3>
        <p className="mt-2 text-sm text-gray-500">
          This run does not include a transcript artifact.
        </p>
      </div>
    );
  }

  if (isLoadingTranscript) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">
        Loading transcript artifact...
      </div>
    );
  }

  if (parsedTranscript.error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
        <h3 className="text-sm font-medium text-red-300">Transcript could not be parsed</h3>
        <p className="mt-2 text-sm text-gray-300">{parsedTranscript.error}</p>
        <button
          type="button"
          onClick={() => onOpenFile(transcriptPath)}
          className="mt-3 rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-cyan-900/60 hover:text-cyan-300"
        >
          Open raw JSONL in Files
        </button>
      </div>
    );
  }

  if (parsedTranscript.entries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="text-sm font-medium text-gray-300">Empty transcript</h3>
        <p className="mt-2 text-sm text-gray-500">
          <code>{transcriptPath}</code> exists but contains no JSONL rows.
        </p>
      </div>
    );
  }

  const answerHref = answerPath
    ? artifactFileContentUrl({
        projectId,
        runId,
        evalId,
        filePath: answerPath,
        artifactDir,
        raw: true,
      })
    : undefined;
  const transcriptHref = artifactFileContentUrl({
    projectId,
    runId,
    evalId,
    filePath: transcriptPath,
    artifactDir,
    raw: true,
  });
  const transcriptDownloadHref = artifactFileContentUrl({
    projectId,
    runId,
    evalId,
    filePath: transcriptPath,
    artifactDir,
    download: true,
  });

  return (
    <TranscriptTimeline
      entries={parsedTranscript.entries}
      finalAnswer={answerPath ? (answerContent?.content ?? result.output) : undefined}
      answerPath={answerPath}
      transcriptPath={transcriptPath}
      answerHref={answerHref}
      transcriptHref={transcriptHref}
      transcriptDownloadHref={transcriptDownloadHref}
      onOpenFile={onOpenFile}
    />
  );
}

function TranscriptTab({
  result,
  runId,
  projectId,
  onOpenFile,
}: {
  result: EvalResult;
  runId: string;
  projectId?: string;
  onOpenFile: (path: string) => void;
}) {
  const evalId = result.testId;
  const artifactDir = result.artifact_dir;
  const {
    data: transcriptData,
    isLoading: isLoadingTranscript,
    error: transcriptError,
  } = projectId
    ? useQuery(projectEvalTranscriptOptions(projectId, runId, evalId, artifactDir))
    : useEvalTranscript(runId, evalId, artifactDir);
  const transcriptPath = transcriptData?.transcript_path;
  const answerPath = transcriptData?.answer_path;
  const transcriptContent = transcriptData?.status === 'ok' ? (transcriptData.content ?? '') : '';

  const parsedTranscript = useMemo(
    () => parseTranscriptJsonl(transcriptContent),
    [transcriptContent],
  );

  if (isLoadingTranscript) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">
        Loading transcript artifact...
      </div>
    );
  }

  if (transcriptError) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
        <h3 className="text-sm font-medium text-red-300">Transcript could not be loaded</h3>
        <p className="mt-2 text-sm text-gray-300">{transcriptError.message}</p>
      </div>
    );
  }

  if (!transcriptData || transcriptData.status === 'missing') {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="text-sm font-medium text-gray-300">No structured transcript</h3>
        <p className="mt-2 text-sm text-gray-500">
          {transcriptData?.message ??
            'This run does not include canonical transcript.jsonl. Dashboard does not parse response.md or markdown transcripts for this view.'}
        </p>
      </div>
    );
  }

  if (transcriptData.status === 'dangling' || transcriptData.status === 'unsupported') {
    return (
      <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
        <h3 className="text-sm font-medium text-amber-300">
          {transcriptData.status === 'dangling'
            ? 'Transcript artifact unavailable'
            : 'Transcript pointer unsupported'}
        </h3>
        <p className="mt-2 text-sm text-gray-300">
          {transcriptData.message ?? 'The transcript artifact could not be resolved.'}
        </p>
        {transcriptPath ? (
          <p className="mt-2 font-mono text-xs text-gray-500">{transcriptPath}</p>
        ) : null}
        {transcriptData.pointer ? (
          <p className="mt-2 font-mono text-xs text-gray-500">{transcriptData.pointer}</p>
        ) : null}
      </div>
    );
  }

  if (parsedTranscript.error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
        <h3 className="text-sm font-medium text-red-300">Transcript could not be parsed</h3>
        <p className="mt-2 text-sm text-gray-300">{parsedTranscript.error}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {transcriptPath ? (
            <>
              <button
                type="button"
                onClick={() => onOpenFile(transcriptPath)}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-cyan-900/60 hover:text-cyan-300"
              >
                Open raw JSONL in Files
              </button>
              <a
                href={artifactFileContentUrl({
                  projectId,
                  runId,
                  evalId,
                  filePath: transcriptPath,
                  artifactDir,
                  raw: true,
                })}
                target="_blank"
                rel="noreferrer"
                className="rounded-md px-3 py-1.5 text-sm text-cyan-400 transition-colors hover:text-cyan-300 hover:underline"
              >
                Open raw JSONL
              </a>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  if (parsedTranscript.entries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="text-sm font-medium text-gray-300">Empty transcript</h3>
        <p className="mt-2 text-sm text-gray-500">
          <code>{transcriptPath}</code> exists but contains no JSONL rows.
        </p>
      </div>
    );
  }

  const answerHref = answerPath
    ? artifactFileContentUrl({
        projectId,
        runId,
        evalId,
        filePath: answerPath,
        artifactDir,
        raw: true,
      })
    : undefined;
  const transcriptHref = transcriptPath
    ? artifactFileContentUrl({
        projectId,
        runId,
        evalId,
        filePath: transcriptPath,
        artifactDir,
        raw: true,
      })
    : undefined;
  const transcriptDownloadHref = transcriptPath
    ? artifactFileContentUrl({
        projectId,
        runId,
        evalId,
        filePath: transcriptPath,
        artifactDir,
        download: true,
      })
    : undefined;

  return (
    <TranscriptTimeline
      entries={parsedTranscript.entries}
      finalAnswer={answerPath ? (transcriptData.answer_content ?? result.output) : undefined}
      answerPath={answerPath}
      transcriptPath={transcriptPath}
      answerHref={answerHref}
      transcriptHref={transcriptHref}
      transcriptDownloadHref={transcriptDownloadHref}
      onOpenFile={onOpenFile}
    />
  );
}

function FilesTab({
  result,
  runId,
  projectId,
  selectedPath,
  onSelectedPathChange,
}: {
  result: EvalResult;
  runId: string;
  projectId?: string;
  selectedPath: string | null;
  onSelectedPathChange: (path: string) => void;
}) {
  const evalId = result.testId;
  const artifactDir = result.artifact_dir;

  // Use project-scoped API hooks when projectId is present
  const { data: filesData } = projectId
    ? useQuery(projectEvalFilesOptions(projectId, runId, evalId, artifactDir))
    : useEvalFiles(runId, evalId, artifactDir);
  const files = filesData?.files ?? [];

  const [localSelectedPath, setLocalSelectedPath] = useState<string | null>(null);
  const [mobileShowTree, setMobileShowTree] = useState(false);

  const requestedPath = selectedPath ?? localSelectedPath;
  const effectivePath = containsFilePath(files, requestedPath)
    ? requestedPath
    : files.length > 0
      ? findFirstFile(files)
      : null;

  const { data: fileContentData, isLoading: isLoadingContent } = projectId
    ? useQuery(
        projectEvalFileContentOptions(projectId, runId, evalId, effectivePath ?? '', artifactDir),
      )
    : useEvalFileContent(runId, evalId, effectivePath ?? '', artifactDir);

  if (files.length === 0) {
    return <p className="text-sm text-gray-500">No artifact files available.</p>;
  }

  const displayValue = effectivePath
    ? isLoadingContent
      ? 'Loading...'
      : (fileContentData?.content ?? '')
    : '';

  const displayLanguage = effectivePath ? (fileContentData?.language ?? 'plaintext') : 'plaintext';

  return (
    <div className="relative flex h-full min-h-0 min-w-0 gap-4 overflow-hidden">
      {/* FileTree panel — desktop: side-by-side, mobile: full-width slide-over */}
      <div
        className={`${mobileShowTree ? 'block' : 'hidden'} min-h-0 w-full overflow-auto md:block md:w-auto`}
      >
        <FileTree
          files={files}
          selectedPath={effectivePath}
          onSelect={(path) => {
            setLocalSelectedPath(path);
            onSelectedPathChange(path);
            // On mobile, auto-switch to content viewer after selecting a file
            setMobileShowTree(false);
          }}
        />
      </div>

      {/* MonacoViewer panel — desktop: side-by-side, mobile: full-width */}
      <div
        className={`${!mobileShowTree ? 'block' : 'hidden'} h-full min-h-0 min-w-0 flex-1 overflow-hidden md:block`}
      >
        <MonacoViewer value={displayValue} language={displayLanguage} height="100%" />
      </div>

      {/* Mobile toggle button — floating bottom-right */}
      <button
        type="button"
        onClick={() => setMobileShowTree(!mobileShowTree)}
        className="md:hidden fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-200 shadow-lg border border-gray-700 hover:bg-gray-700 active:bg-gray-600 transition-colors"
        aria-label={mobileShowTree ? 'Switch to file content viewer' : 'Switch to file tree'}
      >
        {mobileShowTree ? (
          <>
            <span>📄</span>
            <span>Content</span>
          </>
        ) : (
          <>
            <span>📁</span>
            <span>Files</span>
          </>
        )}
      </button>
    </div>
  );
}
