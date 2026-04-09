/**
 * Three-tab eval detail view: Checks (assertions + scores), Files (artifact browser),
 * and Feedback (review comments).
 *
 * Layout: compact header → tabs → full-height content area.
 * Scores and assertions are only visible in the Checks tab.
 * Each assertion card shows a grader-name pill identifying its evaluator.
 */

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import {
  benchmarkEvalFileContentOptions,
  benchmarkEvalFilesOptions,
  isPassing,
  useEvalFileContent,
  useEvalFiles,
  useStudioConfig,
} from '~/lib/api';
import type { AssertionEntry, EvalResult, ScoreEntry } from '~/lib/types';

import { FeedbackPanel } from './FeedbackPanel';
import type { FileNode } from './FileTree';
import { FileTree } from './FileTree';
import { MonacoViewer } from './MonacoViewer';
import { ScoreBar } from './ScoreBar';

interface EvalDetailProps {
  eval: EvalResult;
  runId: string;
  benchmarkId?: string;
}

type Tab = 'checks' | 'files' | 'feedback';

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

export function EvalDetail({ eval: result, runId, benchmarkId }: EvalDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('checks');
  const { data: config } = useStudioConfig();
  const isReadOnly = config?.read_only === true;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'checks', label: 'Checks' },
    { id: 'files', label: 'Files' },
    ...(isReadOnly ? [] : [{ id: 'feedback' as const, label: 'Feedback' }]),
  ];

  return (
    <div className="flex min-h-full flex-col">
      {/* Compact header: test ID + metadata (no scores — scores live in Checks tab) */}
      <div className="flex items-start justify-between border-b border-gray-800 px-4 py-3">
        <div>
          <h3 className="text-lg font-medium">{result.testId}</h3>
          <p className="mt-0.5 text-sm text-gray-400">
            {result.target && <span>Target: {result.target}</span>}
            {result.durationMs != null && (
              <span className="ml-4">{(result.durationMs / 1000).toFixed(1)}s</span>
            )}
            {result.costUsd != null && <span className="ml-4">${result.costUsd.toFixed(4)}</span>}
          </p>
        </div>
      </div>

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
            <ChecksTab result={result} />
          </div>
        )}
        {activeTab === 'files' && (
          <div className="h-full p-4">
            <FilesTab result={result} runId={runId} benchmarkId={benchmarkId} />
          </div>
        )}
        {!isReadOnly && activeTab === 'feedback' && (
          <div className="p-4">
            <FeedbackPanel testId={result.testId} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Pill showing the grader/evaluator name on an assertion card. */
function GraderPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
      {label}
    </span>
  );
}

/** A single assertion row, optionally annotated with its grader name. */
function AssertionCard({
  assertion,
  graderLabel,
}: { assertion: AssertionEntry; graderLabel?: string }) {
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
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-gray-200">
            {assertion.text}
            {assertion.durationMs != null && (
              <span className="ml-2 text-xs text-gray-500">
                ({(assertion.durationMs / 1000).toFixed(1)}s)
              </span>
            )}
          </p>
          {graderLabel && <GraderPill label={graderLabel} />}
        </div>
        {assertion.evidence && <p className="mt-1 text-xs text-gray-400">{assertion.evidence}</p>}
      </div>
    </div>
  );
}

/**
 * Checks tab: overall score → per-evaluator scores → assertions (with grader pills) → failure reasons.
 * Assertions are grouped by evaluator when per-score assertion data is available.
 */
function ChecksTab({ result }: { result: EvalResult }) {
  const { data: config } = useStudioConfig();
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

      {/* Per-evaluator scores */}
      {result.scores && result.scores.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-400">Evaluator Scores</h4>
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
            const graderLabel = s.name ?? s.type ?? `Evaluator ${si + 1}`;
            return (
              <div key={`${s.name ?? s.type ?? si}`} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {graderLabel}
                </h4>
                {s.assertions.map((a, ai) => (
                  <AssertionCard
                    key={`${a.text}-${ai}`}
                    assertion={a}
                    graderLabel={s.name ?? s.type ?? undefined}
                  />
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

function FilesTab({
  result,
  runId,
  benchmarkId,
}: { result: EvalResult; runId: string; benchmarkId?: string }) {
  const evalId = result.testId;

  // Use benchmark-scoped API hooks when benchmarkId is present
  const { data: filesData } = benchmarkId
    ? useQuery(benchmarkEvalFilesOptions(benchmarkId, runId, evalId))
    : useEvalFiles(runId, evalId);
  const files = filesData?.files ?? [];

  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const effectivePath = selectedPath ?? (files.length > 0 ? findFirstFile(files) : null);

  const { data: fileContentData, isLoading: isLoadingContent } = benchmarkId
    ? useQuery(benchmarkEvalFileContentOptions(benchmarkId, runId, evalId, effectivePath ?? ''))
    : useEvalFileContent(runId, evalId, effectivePath ?? '');

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
    <div className="flex h-full min-h-[400px] gap-4">
      <FileTree files={files} selectedPath={effectivePath} onSelect={setSelectedPath} />
      <div className="flex-1">
        <MonacoViewer value={displayValue} language={displayLanguage} height="100%" />
      </div>
    </div>
  );
}
